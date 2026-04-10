import { ASTNormalizer } from './ast_normalizer.js';
import { ScopeAnalyzer } from './scope_analyzer.js';
import { WatGenerator } from './wat_generator.js';

class SignWasmCompiler {
  compile(ast) {
    const normalizedAst = (new ASTNormalizer()).normalize(ast);
    const locals = (new ScopeAnalyzer()).analyze(normalizedAst);
    return (new WatGenerator(locals)).generate(normalizedAst);
  }
}

export function compileToWat(ast) { return (new SignWasmCompiler()).compile(ast); }
