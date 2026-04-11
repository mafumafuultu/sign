import fs from 'fs';
import path from 'path';
import util from 'util';
import operators from './operators.js';
import { parseSign } from './parser_browser.js';
import { ASTNormalizer } from './ast_normalizer.js';
import { AArch64Generator } from './aarch64_generator.js';
import { Linker } from './linker.js';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node test_cli.js <source.sn>");
  process.exit(1);
}

const sourceFile = args[0];
if (!fs.existsSync(sourceFile)) {
    console.error(`Error: File not found: ${sourceFile}`);
    process.exit(1);
}

const sourceCode = fs.readFileSync(sourceFile, 'utf8');

console.log(`\n=======================================\n`);
console.log(`--- Parsing ${sourceFile} ---`);
console.log(`\n=======================================\n`);

let ast;
try {
  ast = parseSign(sourceCode);
} catch (e) {
  console.error("Parse Error:", e);
  process.exit(1);
}

console.log("\n--- Linking Modules ---");
const linker = new Linker();
let linkedAst;
try {
  let baseDir = path.dirname(path.resolve(sourceFile));
  linkedAst = linker.link(ast, baseDir);
} catch (e) {
  console.error("Link Error:", e);
  process.exit(1);
}

console.log("\n--- Normalizing AST ---");
const normalizer = new ASTNormalizer();
let normalizedAst;
try {
  normalizedAst = normalizer.normalize(linkedAst);
  // ASTダンプを全階層表示します (深さ制限を解除)
  console.log(util.inspect(normalizedAst, { showHidden: false, depth: null, colors: true }));
} catch (e) {
  console.error("Normalize Error:", e);
  process.exit(1);
}

console.log("\n--- Generating AArch64 Assembly ---");
const generator = new AArch64Generator();
let asmCode = "";
try {
  asmCode = generator.generate(normalizedAst);
  fs.writeFileSync('output.s', asmCode);
  console.log("-> Saved to output.s. Assembly Output:");
  console.log(asmCode);
} catch (e) {
  console.error("Generate Error:", e);
  process.exit(1);
}

console.log("\n--- Compiling via WSL (aarch64-linux-gnu-gcc) ---");
try {
  execSync('wsl aarch64-linux-gnu-gcc -static output.s -o output.elf -lm', { stdio: 'inherit' });
  console.log("-> Compiled successfully to output.elf");
} catch (e) {
  console.error("Compile Error. 実行には WSL 内に 'aarch64-linux-gnu-gcc' が必要です。");
  process.exit(1);
}

console.log("\n--- Executing via WSL QEMU ---");
try {
  // qemu-aarch64 実行。パッケージが未インストールの場合エラー終了する。
  const result = execSync('wsl qemu-aarch64 -L /usr/aarch64-linux-gnu ./output.elf').toString();
  console.log("\n[Execution Result]");
  console.log(result.trim());
} catch (e) {
  console.error("\n[WARNING] Execution failed with code " + e.status);
  if (e.stdout || e.stderr) {
    if (e.stdout) console.log("Standard Output:\n" + e.stdout.toString().trim());
    if (e.stderr) console.error("Standard Error:\n" + e.stderr.toString().trim());
  } else {
    console.log("QEMUエミュレータが存在しない可能性があります。以下のコマンドをWSL環境で実行してインストールしてください:");
    console.log("  wsl sudo apt-get update && wsl sudo apt-get install -y qemu-user");
  }
}
