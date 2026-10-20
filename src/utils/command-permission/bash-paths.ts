import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Bash 静态命令分析结果；递归目标还需检查子项的真实路径。 */
export interface BashPathAnalysis {
  valid: boolean;
  paths: string[];
  recursivePaths: string[];
  /** 命令是否只包含读取操作。 */
  readOnly: boolean;
}

/** 单条命令的校验结果与是否只读。 */
interface CommandInspection {
  valid: boolean;
  readOnly: boolean;
}

/** 移除会改变 Bash 启动行为的继承环境，分析进程与实际命令共用。 */
export function getBashEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('BASH_FUNC_') ||
      [
        'BASH_ENV',
        'ENV',
        'SHELLOPTS',
        'BASHOPTS',
        'CDPATH',
        'GLOBIGNORE',
        'POSIXLY_CORRECT',
        'BASH_COMPAT',
      ].includes(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

interface Word {
  raw: string;
  glob: boolean;
}

interface Token {
  word?: Word;
  operator?: string;
}

const separators = new Set([';', '&&', '||', '|', '|&']);
const redirects = new Set(['>', '>>', '>|', '<', '<>', '&>', '&>>', '>&', '<&']);
const blockedCommands = new Set([
  'cd',
  'pushd',
  'popd',
  'eval',
  'exec',
  'source',
  '.',
  'alias',
  'unalias',
  'export',
  'unset',
  'declare',
  'typeset',
  'local',
  'readonly',
  'read',
  'mapfile',
  'readarray',
  'set',
  'shopt',
  'trap',
  'enable',
  'hash',
  'builtin',
  'command',
  'env',
  'sudo',
  'su',
  'xargs',
  'bash',
  'sh',
  'dash',
  'zsh',
  'fish',
  'ksh',
  'pwsh',
  'powershell',
  'cmd',
  'ssh',
  'nohup',
  'timeout',
  'time',
  'coproc',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'select',
  '!',
  '[[',
  '[',
  'test',
  'sed',
  'awk',
]);
const fileCommands = new Set([
  'cat',
  'ls',
  'head',
  'tail',
  'wc',
  'sort',
  'uniq',
  'cut',
  'paste',
  'tee',
  'cp',
  'mv',
  'rm',
  'mkdir',
  'rmdir',
  'touch',
  'stat',
  'file',
  'du',
  'df',
  'readlink',
  'realpath',
  'diff',
  'cmp',
  'comm',
  'basename',
  'dirname',
]);
// 参数角色按命令声明，文本、数字参数不参与路径判断。
const valueOptions: Record<string, string[]> = {
  head: ['-n', '-c', '--lines', '--bytes'],
  tail: [
    '-n',
    '-c',
    '-s',
    '--lines',
    '--bytes',
    '--sleep-interval',
    '--pid',
    '--max-unchanged-stats',
  ],
  sort: ['-k', '-t', '--key', '--field-separator', '--parallel', '-S', '--buffer-size'],
  uniq: ['-f', '-s', '-w', '--skip-fields', '--skip-chars', '--check-chars'],
  cut: [
    '-b',
    '-c',
    '-f',
    '-d',
    '--bytes',
    '--characters',
    '--fields',
    '--delimiter',
    '--output-delimiter',
  ],
  paste: ['-d', '--delimiters'],
  ls: [
    '--color',
    '--format',
    '--sort',
    '--time',
    '--time-style',
    '--quoting-style',
    '-I',
    '--ignore',
    '--hide',
    '-w',
    '--width',
    '--block-size',
  ],
  mkdir: ['-m', '--mode'],
  touch: ['-t', '-d', '--date'],
  stat: ['-c', '--format', '--printf'],
  du: ['-d', '--max-depth', '--block-size', '--exclude'],
  df: ['-t', '-x', '--type', '--exclude-type', '--block-size', '--output'],
  diff: ['-U', '-C', '--unified', '--context', '-I', '--ignore-matching-lines', '-x', '--exclude'],
};
const pathOptions: Record<string, string[]> = {
  cp: ['-t', '--target-directory'],
  mv: ['-t', '--target-directory'],
  sort: ['-o', '--output', '-T', '--temporary-directory'],
  touch: ['-r', '--reference'],
  diff: ['-X', '--exclude-from'],
};
const shortFlags: Record<string, string> = {
  cat: 'AbEenstTuv',
  ls: 'aAbBcCdDfFgGhHiIklmnpqQrRsStTuUvwxX1',
  head: 'qvz',
  tail: 'fFqvz',
  wc: 'clmwL',
  sort: 'bdfghinMnrRsuVz',
  uniq: 'cdiuzD',
  cut: 'nsz',
  paste: 'sz',
  tee: 'ai',
  cp: 'abdfHiklnpPrRsuTvx',
  mv: 'bfintuvTZ',
  rm: 'dfirRvI',
  mkdir: 'pvZ',
  rmdir: 'pv',
  touch: 'acfh',
  stat: 'ft',
  file: 'bchikLnNprsz',
  du: 'achksx',
  df: 'ahikPT',
  readlink: 'efmnqsvz',
  realpath: 'eLmPqsz',
  diff: 'abBcdDeEfHinqrsStyuwy',
  cmp: 'bls',
  comm: '123z',
  basename: 'az',
  dirname: 'z',
};
const longFlags = new Set([
  '--help',
  '--version',
  '--recursive',
  '--archive',
  '--force',
  '--verbose',
  '--parents',
  '--no-target-directory',
  '--no-clobber',
  '--preserve',
  '--number',
  '--human-readable',
  '--all',
  '--summarize',
  '--null',
]);

/** 只分析静态简单命令、管道和重定向；动态 Shell 语法明确拒绝。 */
export async function getBashPaths(
  command: string,
  cwd: string,
  shellPath: string
): Promise<BashPathAnalysis> {
  const invalid: BashPathAnalysis = {
    valid: false,
    paths: [],
    recursivePaths: [],
    readOnly: false,
  };
  const tokens = tokenize(command);
  if (!tokens) return invalid;
  const options = { cwd, env: getBashEnvironment(), maxBuffer: 10 * 1024 * 1024, timeout: 15_000 };
  try {
    // -n 仅检查语法；-p 禁止 BASH_ENV、继承函数及 Shell 选项改变分析语义。
    await execFileAsync(shellPath, ['--noprofile', '--norc', '-p', '-n', '-c', command], options);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 2)
      return invalid;
    throw error;
  }

  const words = tokens.flatMap(token => (token.word ? [token.word] : []));
  // raw 来自受限词法分析，只含常量及文件名展开；不执行任何用户命令或表达式。
  const expansion = words.map(word => `set -- ${word.raw}; printf '%s\\0' "$#" "$@"`).join('\n');
  const { stdout } = await execFileAsync(
    shellPath,
    ['--noprofile', '--norc', '-p', '-c', expansion],
    options
  );
  const fields = stdout.split('\0');
  const expanded = new Map<Word, string[]>();
  let offset = 0;
  for (const word of words) {
    const count = Number(fields[offset++]);
    if (!Number.isInteger(count) || count < 1 || offset + count > fields.length - 1) return invalid;
    expanded.set(word, fields.slice(offset, offset + count));
    offset += count;
  }
  const paths: string[] = [];
  const recursivePaths: string[] = [];
  let readOnly = true;
  let args: string[] = [];
  const flush = async () => {
    if (!args.length) return true;
    const current = args;
    args = [];
    const inspection = await inspectCommand(current, cwd, paths, recursivePaths);
    if (!inspection.readOnly) readOnly = false;
    return inspection.valid;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.word) {
      const values = expanded.get(token.word)!;
      if (!args.length && (values.length !== 1 || token.word.glob)) return invalid;
      // 即使 echo/printf 使用展开结果作为文本，也不能借通配符遍历目录外。
      if (token.word.glob) paths.push(...values);
      args.push(...values);
    } else if (separators.has(token.operator!)) {
      if (!(await flush())) return invalid;
    } else {
      const word = tokens[++i]?.word;
      if (!word) return invalid;
      const values = expanded.get(word)!;
      if (values.length !== 1 || !values[0]) return invalid;
      const fd = token.operator === '>&' || token.operator === '<&';
      const fdTarget = fd && /^(?:[0-9]+-?|-)$/.test(values[0]);
      if (!fdTarget) {
        paths.push(values[0]);
        if (token.operator !== '<') readOnly = false;
      }
    }
  }
  if (!(await flush())) return invalid;
  return { valid: true, paths, recursivePaths, readOnly };
}

function tokenize(command: string): Token[] | null {
  const tokens: Token[] = [];
  let raw = '';
  let quote = '';
  let glob = false;
  const flush = () => {
    if (raw) tokens.push({ word: { raw, glob } });
    raw = '';
    glob = false;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\0') return null;
    if (quote === "'") {
      raw += char;
      if (char === "'") quote = '';
      continue;
    }
    if (char === '\\') {
      if (i + 1 === command.length) return null;
      const next = command[++i];
      if (next !== '\n') raw += '\\' + next;
      continue;
    }
    if (char === '$' || char === '`') return null;
    if (quote === '"') {
      raw += char;
      if (char === '"') quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      raw += char;
      continue;
    }
    if ('(){}'.includes(char)) return null;
    if (char === '#' && !raw) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      if (char === '\n') tokens.push({ operator: ';' });
      continue;
    }
    if (';&|<>'.includes(char)) {
      let operator = char;
      for (const candidate of ['&>>', '>>', '>|', '<>', '&>', '>&', '<&', '&&', '||', '|&']) {
        if (command.startsWith(candidate, i)) {
          operator = candidate;
          break;
        }
      }
      if (!separators.has(operator) && !redirects.has(operator)) return null;
      if (redirects.has(operator) && /^\d+$/.test(raw)) raw = '';
      flush();
      tokens.push({ operator });
      i += operator.length - 1;
      continue;
    }
    if ('*?['.includes(char)) glob = true;
    raw += char;
  }
  if (quote) return null;
  flush();
  // 不支持 here-doc、here-string 和缺少目标的重定向。
  for (let i = 0; i < tokens.length; i++) {
    if (redirects.has(tokens[i].operator!) && !tokens[++i]?.word) return null;
  }
  return tokens;
}

async function inspectCommand(
  args: string[],
  cwd: string,
  paths: string[],
  recursivePaths: string[]
): Promise<CommandInspection> {
  const invalid: CommandInspection = { valid: false, readOnly: false };
  const [executable, ...operands] = args;
  const name = path.basename(executable);
  if (!executable || executable.includes('=') || blockedCommands.has(name)) return invalid;
  if (executable.includes('/')) paths.push(executable);
  if (name === 'echo') return { valid: true, readOnly: true };
  if (name === 'printf') {
    const format = operands[0] === '--' ? operands[1] : operands[0];
    const valid =
      !operands.some(arg => arg.startsWith('-v')) &&
      !/%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?n/.test(format ?? '');
    return { valid, readOnly: valid };
  }
  if (['pwd', 'true', 'false'].includes(name)) return { valid: true, readOnly: true };
  if (name === 'find') return inspectFind(operands, paths);
  if (['grep', 'rg'].includes(name)) {
    const valid = inspectSearch(name, operands, paths);
    return { valid, readOnly: valid };
  }
  if (fileCommands.has(name)) {
    const valid = inspectFileArguments(name, operands, paths, recursivePaths);
    return { valid, readOnly: valid && isReadOnlyFileCommand(name, operands) };
  }
  // 外部程序内部行为不属于路径预检查；拒绝常见内联代码入口。
  if (
    ['node', 'nodejs', 'python', 'python3', 'perl', 'ruby'].includes(name) &&
    operands.some(arg => /^-(?:[^-]*[ecp]|-eval|-print|-require|-import)/.test(arg))
  )
    return invalid;
  for (const argument of operands) {
    const candidate = argument.replace(/^(?:--?)?[\w-]+=/, '').replace(/^-[CILo](?=.)/, '');
    if (/^https?:\/\//i.test(candidate)) continue;
    if (candidate === argument && argument.startsWith('-') && argument.includes('/'))
      return invalid;
    if (candidate.includes('/') || candidate === '..' || candidate.startsWith('~')) {
      paths.push(candidate);
    } else {
      try {
        await fs.lstat(path.resolve(cwd, candidate));
        paths.push(candidate);
      } catch (error) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
    }
  }
  return { valid: true, readOnly: false };
}

/** 判断文件类命令本身是否只读取；排序输出、临时目录和 uniq 输出文件属于写操作。 */
function isReadOnlyFileCommand(name: string, args: string[]): boolean {
  if (['tee', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch'].includes(name)) return false;
  if (name === 'uniq') return countFileOperands(name, args) < 2;
  if (name !== 'sort') return true;
  return !args.some(
    arg =>
      arg === '-o' ||
      arg.startsWith('-o') ||
      arg === '-T' ||
      arg.startsWith('-T') ||
      arg === '--output' ||
      arg.startsWith('--output=') ||
      arg === '--temporary-directory' ||
      arg.startsWith('--temporary-directory=')
  );
}

/** 统计命令中的文件操作数，跳过选项及其独立取值。 */
function countFileOperands(name: string, args: string[]): number {
  let count = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      count += args.length - i - 1;
      break;
    }
    if (arg.startsWith('-') && arg !== '-') {
      const option = (valueOptions[name] ?? []).find(
        entry =>
          arg === entry ||
          arg.startsWith(entry + '=') ||
          (entry.length === 2 && arg.startsWith(entry))
      );
      if (option && !arg.slice(option.length).replace(/^=/, '')) i++;
      continue;
    }
    count++;
  }
  return count;
}

function inspectFileArguments(
  name: string,
  args: string[],
  paths: string[],
  recursivePaths: string[]
): boolean {
  let options = true;
  let targetDirectory = false;
  let recursive = name === 'mv';
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (options && arg === '--') {
      options = false;
      continue;
    }
    if (options && arg.startsWith('-') && arg !== '-') {
      if (
        ['cp', 'rm'].includes(name) &&
        (/^-[^-]*[rRa]/.test(arg) || arg === '--recursive' || arg === '--archive')
      )
        recursive = true;
      // 不跟随递归链接，也不允许通过选项引入文件列表或执行其他程序。
      if (
        /^-[^-]*L/.test(arg) ||
        ['--dereference', '--files0-from', '--compress-program'].some(
          option => arg === option || arg.startsWith(option + '=')
        )
      )
        return false;
      const key = arg.split('=')[0];
      const roles = [...(valueOptions[name] ?? []), ...(pathOptions[name] ?? [])];
      const option = roles.find(
        entry => key === entry || (entry.length === 2 && arg.startsWith(entry))
      );
      if (option) {
        const attached = arg.slice(option.length).replace(/^=/, '');
        const value = attached || args[++i];
        if (value === undefined) return false;
        if (pathOptions[name]?.includes(option)) {
          if (!value) return false;
          paths.push(value);
        }
        if (option === '-t' || option === '--target-directory') targetDirectory = true;
      } else if (
        !longFlags.has(arg) &&
        !(/^-[^-]+$/.test(arg) && [...arg.slice(1)].every(char => shortFlags[name]?.includes(char)))
      ) {
        // 未声明选项或携带值的组合短选项不能保证没有隐藏路径。
        return false;
      }
      continue;
    }
    if (!arg) return false;
    if (arg !== '-') {
      paths.push(arg);
      operands.push(arg);
    }
  }
  if (recursive)
    recursivePaths.push(...(name === 'rm' || targetDirectory ? operands : operands.slice(0, -1)));
  return true;
}

function inspectSearch(name: string, args: string[], paths: string[]): boolean {
  const textOptions = new Set([
    '-e',
    '--regexp',
    '-g',
    '--glob',
    '--iglob',
    '-t',
    '--type',
    '-T',
    '--type-not',
    '-m',
    '--max-count',
    '-A',
    '-B',
    '-C',
    '--after-context',
    '--before-context',
    '--context',
    '--include',
    '--exclude',
    '--exclude-dir',
    '--encoding',
    '-j',
    '--threads',
  ]);
  const fileOptions = new Set(['-f', '--file', '--exclude-from']);
  let pattern = false;
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (options && arg === '--') {
      options = false;
      continue;
    }
    if (options && arg.startsWith('-') && arg !== '-') {
      const option = [...textOptions, ...fileOptions].find(
        key => arg === key || arg.startsWith(key + '=') || (key.length === 2 && arg.startsWith(key))
      );
      if (option) {
        const attached = arg.slice(option.length).replace(/^=/, '');
        const value = attached || args[++i];
        if (value === undefined) return false;
        if (fileOptions.has(option)) {
          if (!value) return false;
          paths.push(value);
        }
        if (['-e', '--regexp', '-f', '--file'].includes(option)) pattern = true;
      } else if (
        !/^-[ivnHhlocrqsFwExabzUV]+$/.test(arg) &&
        ![
          '--hidden',
          '--files',
          '--line-number',
          '--files-with-matches',
          '--ignore-case',
          '--fixed-strings',
          '--no-ignore',
          '--recursive',
          '--count',
          '--no-heading',
          '--with-filename',
          '--no-filename',
          '--quiet',
        ].includes(arg)
      )
        return false;
      continue;
    }
    if (!pattern && !(name === 'rg' && args.includes('--files'))) pattern = true;
    else {
      if (!arg) return false;
      if (arg !== '-') paths.push(arg);
    }
  }
  return true;
}

function inspectFind(args: string[], paths: string[]): CommandInspection {
  const invalid: CommandInspection = { valid: false, readOnly: false };
  let readOnly = true;
  const textOptions = new Set([
    '-name',
    '-iname',
    '-path',
    '-ipath',
    '-regex',
    '-iregex',
    '-type',
    '-maxdepth',
    '-mindepth',
    '-size',
    '-mtime',
    '-mmin',
    '-atime',
    '-amin',
    '-ctime',
    '-cmin',
    '-user',
    '-group',
    '-perm',
    '-printf',
  ]);
  const pathOptions = new Set([
    '-newer',
    '-anewer',
    '-cnewer',
    '-samefile',
    '-fprint',
    '-fprint0',
    '-fls',
  ]);
  const flags = new Set([
    '-P',
    '-print',
    '-print0',
    '-ls',
    '-delete',
    '-empty',
    '-type',
    '-readable',
    '-writable',
    '-executable',
    '-prune',
    '-depth',
    '-xdev',
    '-mount',
    '-a',
    '-and',
    '-o',
    '-or',
    '-not',
    '!',
  ]);
  let expression = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-P' && !expression) continue;
    if (arg.startsWith('-') || arg === '!') expression = true;
    if (textOptions.has(arg) || pathOptions.has(arg)) {
      const value = args[++i];
      if (!value) return invalid;
      if (pathOptions.has(arg)) {
        paths.push(value);
        if (['-fprint', '-fprint0', '-fls'].includes(arg)) readOnly = false;
      }
    } else if (flags.has(arg)) {
      if (arg === '-delete') readOnly = false;
      continue;
    } else if (expression || !arg) return invalid;
    else paths.push(arg);
  }
  return { valid: true, readOnly };
}
