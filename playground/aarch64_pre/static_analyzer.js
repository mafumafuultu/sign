import fs from 'fs';

export class StaticAnalyzer {
  constructor() {
    this.typeTable = {
      functions: {}, // { id: "func_1", pure: true, captures: [], node: ASTNode }
      structs: {},   // Placeholder for struct mappings
      variables: {}, // { "myVar": { typeKind: "Float" | "UInt" | "Function" | "Pointer" | "Dict" } }
      warnings: []   // Any type deduction failures
    };
    this.funcCounter = 0;
  }

  analyze(ast) {
    this.typeTable = { functions: {}, structs: {}, variables: {}, warnings: [] };
    this.funcCounter = 0;
    
    // First Pass: Type Inference and structure
    this.inferType(ast, new Set());

    // Second Pass: Function Pureness & Captures
    this.traverse(ast, new Set());

    return this.typeTable;
  }

  // Type Inference Pass
  inferType(node, boundEnv) {
    if (!node) return { typeKind: 'Unknown' };

    // If already inferred, return cached (prevent collision with ast_normalizer)
    if (node.inferredStaticType) return { ...node.inferredStaticType };

    let type = { typeKind: 'Unknown' };

    switch (node.type) {
      case 'number':
        type.typeKind = Number.isInteger(node.value) ? 'UInt' : 'Float';
        break;
      case 'string':
        type.typeKind = 'Pointer'; // String literals are pointers to memory
        break;
      case 'prefix':
        if (node.op === '~') {
          type.typeKind = 'Pointer'; 
        } else {
          // ! !! etc.
          let rightType = this.inferType(node.expr, boundEnv);
          type.typeKind = rightType.typeKind;
        }
        break;
      case 'infix':
        if (node.op === '?') {
          type.typeKind = 'Function';
          // Propagate inference into children
          let newEnv = new Set(boundEnv);
          if (node.left && node.left.type === 'identifier') {
            newEnv.add(node.left.value);
            // Prefix ~ in args means pointer
            if (node.left.value.startsWith('~')) {
              this.typeTable.variables[node.left.value] = { typeKind: 'Pointer' };
            }
          }
          this.inferType(node.right, newEnv);
        } else if (node.op === ':') {
          type = this.inferType(node.right, boundEnv);
          if (node.left && node.left.type === 'identifier') {
            // Assign type to variable
            let vName = node.left.value;
            this.typeTable.variables[vName] = { ...type };
            node.left.inferredStaticType = { ...type };
          }
        } else if (node.op === ',') {
          type.typeKind = 'Pointer';
          this.inferType(node.left, boundEnv);
          this.inferType(node.right, boundEnv);
        } else if (node.op === '\'') {
          let lt = this.inferType(node.left, boundEnv);
          let rt = this.inferType(node.right, boundEnv);
          if (lt.typeKind !== 'Dict' && lt.typeKind !== 'Pointer') {
              this.typeTable.warnings.push(`Warning: Property access (') on non-Dict/Pointer type: ${lt.typeKind}.`);
          }
          type.typeKind = 'Float'; // Usually fetches scalar/ptr unless specified
        } else if (['+', '-', '*', '/', '%', '^'].includes(node.op)) {
          let lt = this.inferType(node.left, boundEnv);
          let rt = this.inferType(node.right, boundEnv);
          
          if (lt.typeKind === 'Function' || rt.typeKind === 'Function') {
              this.typeTable.warnings.push(`Warning: Arithmetic operation '${node.op}' applied to a Function Type. Math expects Scalar/Pointer.`);
          }
          if (lt.typeKind === 'Dict' || rt.typeKind === 'Dict') {
              this.typeTable.warnings.push(`Warning: Arithmetic operation '${node.op}' applied to a Dict Type. Math expects Scalar/Pointer.`);
          }
          
          if (lt.typeKind === 'Float' || rt.typeKind === 'Float') {
            type.typeKind = 'Float';
          } else if (lt.typeKind === 'UInt' && rt.typeKind === 'UInt') {
             type.typeKind = 'UInt';
          } else {
             type.typeKind = 'Float'; // scalar fallback
          }
        } else {
          // Other infix ops
          this.inferType(node.left, boundEnv);
          this.inferType(node.right, boundEnv);
          type.typeKind = 'Float'; // default scalar
        }
        break;
      case 'group':
        type = this.inferType(node.expr, boundEnv);
        break;
      case 'identifier':
        if (this.typeTable.variables[node.value]) {
          type = this.typeTable.variables[node.value];
        } else if (node.value.startsWith('~')) {
           type.typeKind = 'Pointer';
           this.typeTable.variables[node.value] = type;
        } else if (boundEnv.has(node.value)) {
           // We don't strictly know type from unbound variables unless typed elsewhere
           // Treat as generic Float/Scalar for now
        } else {
           if (node.value !== '_' && node.value !== 'nan' && node.value !== 'inf') {
               this.typeTable.warnings.push(`Warning: Type of '${node.value}' is unknown or not explicitly declared. Assuming Float/Scalar.`);
           }
        }
        break;
      case 'block':
      case 'ModuleBlock':
        let currentEnv = new Set(boundEnv);
        // Blocks have no default type unless specified
        // But if it contains `#`, it is a Dict.
        let hasExports = false;

        if (node.body && Array.isArray(node.body)) {
            for (let stmt of node.body) {
                if (stmt.type === 'prefix' && (stmt.op === '#' || stmt.op === '##')) {
                    hasExports = true;
                }
                if (stmt.type === 'infix' && stmt.op === ':') {
                    if (stmt.left && stmt.left.type === 'identifier') {
                        currentEnv.add(stmt.left.value);
                    }
                }
                this.inferType(stmt, currentEnv);
            }
            if (node.body.length > 0) {
              type = node.body[node.body.length - 1].inferredType || { typeKind: 'Unknown' };
            }
        }

        if (hasExports) {
            type.typeKind = 'Dict';
        }
        break;
    }

    node.inferredStaticType = { ...type };
    return { ...type };
  }

  getFreeVariables(node, boundVars) {
    let freeVars = new Set();
    if (!node) return freeVars;

    const traverse = (n, bound) => {
      if (!n) return;

      if (n.type === 'identifier') {
        const vName = n.value;
        if (!bound.has(vName) && vName !== '_' && vName !== 'nan' && vName !== 'inf') {
          freeVars.add(vName);
        }
      } else if (n.type === 'infix') {
        if (n.op === '?') {
          // Lambda definition
          let newBound = new Set(bound);
          if (n.left && n.left.type === 'identifier') newBound.add(n.left.value);
          traverse(n.right, newBound);
        } else if (n.op === ':') {
          // Assignment / pattern
          traverse(n.right, bound);
          let newBound = new Set(bound);
          if (n.left && n.left.type === 'identifier') newBound.add(n.left.value);
          traverse(n.left, newBound); 
        } else {
          traverse(n.left, bound);
          traverse(n.right, bound);
        }
      } else if (n.type === 'block' || n.type === 'ModuleBlock' || n.type === 'RangeDemo') {
        let currentBound = new Set(bound);
        if (n.body && Array.isArray(n.body)) {
            for (let stmt of n.body) {
                if (stmt.type === 'infix' && stmt.op === ':') {
                    traverse(stmt.right, currentBound);
                    if (stmt.left && stmt.left.type === 'identifier') {
                        currentBound.add(stmt.left.value);
                    }
                } else {
                    traverse(stmt, currentBound);
                }
            }
        } else {
            if (n.start) traverse(n.start, currentBound);
            if (n.step) traverse(n.step, currentBound);
            if (n.end) traverse(n.end, currentBound);
        }
      } else {
        ['left', 'right', 'expr', 'func', 'arg', 'body'].forEach(key => {
          if (n[key]) traverse(n[key], bound);
        });
      }
    };

    traverse(node, boundVars);
    return freeVars;
  }

  traverse(node, boundEnv) {
    if (!node) return;

    if (node.type === 'infix' && node.op === '?') {
      const funcId = `func_${this.funcCounter++}`;
      
      // Determine captures
      let lambdaBound = new Set();
      if (node.left && node.left.type === 'identifier') {
        lambdaBound.add(node.left.value);
      }
      
      const freeVars = this.getFreeVariables(node.right, lambdaBound);
      
      // Filter free vars to see what is captured from parent scope
      const captures = [];
      freeVars.forEach(v => {
        if (boundEnv.has(v)) {
          captures.push(v);
        } else {
          captures.push(v);
        }
      });

      this.typeTable.functions[funcId] = {
        pure: captures.length === 0,
        captures: captures,
        nodeRef: node
      };

      // Assign ID to AST node for generator to use
      node._staticFuncId = funcId;

      let newEnv = new Set(boundEnv);
      if (node.left && node.left.type === 'identifier') newEnv.add(node.left.value);
      this.traverse(node.right, newEnv);
      return;
    }

    if (node.type === 'block' || node.type === 'ModuleBlock') {
        let currentBound = new Set(boundEnv);
        if (node.body && Array.isArray(node.body)) {
            for (let stmt of node.body) {
                if (stmt.type === 'infix' && stmt.op === ':') {
                    if (stmt.left && stmt.left.type === 'identifier') {
                        currentBound.add(stmt.left.value);
                    }
                }
                this.traverse(stmt, currentBound);
            }
        }
        return;
    }

    ['left', 'right', 'expr', 'func', 'arg', 'body', 'start', 'step', 'end'].forEach(key => {
      if (Array.isArray(node[key])) {
          node[key].forEach(child => this.traverse(child, boundEnv));
      } else if (node[key]) {
          this.traverse(node[key], boundEnv);
      }
    });
  }
}
