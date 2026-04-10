export class ScopeAnalyzer {
  constructor() {
    this.locals = new Set();
    this.locals.add('tmp_l');
    this.locals.add('tmp_r');
    this.locals.add('tmp_cond');
  }

  analyze(ast) {
    this.visit(ast);
    return Array.from(this.locals);
  }

  visit(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(n => this.visit(n));
      return;
    }

    if (node.type === 'block' && node.body) {
      node.body.forEach(n => this.visit(n));
      return;
    }

    const varName = node.name || node.value || node.text;

    if (node.type === 'infix' && node.op === ':') {
      if (node.left && (node.left.type === 'identifier' || node.left.type === 'variable')) {
        const lName = node.left.name || node.left.value || node.left.text;
        if (lName && lName !== '_' && lName !== 'nan') {
          this.locals.add(lName);
        }
      }
    }

    if (node.type === 'identifier' || node.type === 'variable') {
      if (varName && varName !== '_' && varName !== 'nan') {
        this.locals.add(varName);
      }
    }

    ['left', 'right', 'cond', 'expr', 'argument', 'operand', 'base', 'body', 'content', 'value'].forEach(key => {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          node[key].forEach(n => this.visit(n));
        } else {
          this.visit(node[key]);
        }
      }
    });
  }
}
