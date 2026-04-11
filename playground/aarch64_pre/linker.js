import fs from 'fs';
import path from 'path';
import util from 'util';
import { parseSign } from './parser_browser.js';

export class Linker {
    constructor() {
        this.resolvedFiles = new Set();
    }

    link(ast, baseDir) {
        if (!ast) return ast;

        if (Array.isArray(ast)) {
            return ast.map(node => this.link(node, baseDir));
        }

        let node = { ...ast };

        // Postfix @ evaluation (Importing)
        if (node.type === 'postfix' && node.op === '@') {
            let targetExpr = node.expr || node.left;
            if (targetExpr && targetExpr.type === 'string') {
                let relPath = targetExpr.value.replace(/^[`'"]|[`'"]$/g, '');
                let absPath = path.resolve(baseDir, relPath);
                
                if (this.resolvedFiles.has(absPath)) {
                    throw new Error(`Circular dependency detected: ${relPath}`);
                }
                
                if (!fs.existsSync(absPath)) {
                    throw new Error(`Module file not found: ${absPath}`);
                }
                
                this.resolvedFiles.add(absPath);
                
                const sourceCode = fs.readFileSync(absPath, 'utf8');
                const moduleAst = parseSign(sourceCode);
                
                // Recursively link the imported module
                const linkedModuleAst = this.link(moduleAst, path.dirname(absPath));
                
                // Extract Exported Declarations (# prefix)
                let exportsList = [];
                
                const processExports = (n) => {
                    if (!n) return;
                    if (Array.isArray(n)) {
                        n.forEach(processExports);
                        return;
                    }
                    if (n.type === 'prefix' && n.op === '#') {
                        let e = n.expr || n.right;
                        if (e && e.type === 'infix' && e.op === ':') {
                             if (e.left && e.left.type === 'identifier') {
                                 exportsList.push(e.left.value);
                             }
                        }
                    }
                    
                    if (n.body) processExports(n.body);
                    if (n.left) processExports(n.left);
                    if (n.right) processExports(n.right);
                    if (n.expr) processExports(n.expr);
                };
                
                processExports(linkedModuleAst);
                
                // Construct the return dictionary for the module block
                let exportDict = { type: 'number', value: 'nan' };
                if (exportsList.length > 0) {
                     for(let i = exportsList.length - 1; i >= 0; i--) {
                         let eName = exportsList[i];
                         let kvPair = {
                             type: 'infix', op: ',',
                             left: { type: 'string', value: '\`' + eName + '\`' },
                             right: {
                                 type: 'infix', op: ',',
                                 left: { type: 'identifier', value: eName },
                                 right: exportDict
                             }
                         };
                         exportDict = kvPair;
                     }
                     exportDict = { type: 'group', body: exportDict };
                }
                
                // Strip `#` from the AST nodes so they become normal assignments
                const stripHash = (n) => {
                    if (!n) return n;
                    if (Array.isArray(n)) return n.map(stripHash);
                    if (n.type === 'prefix' && n.op === '#') return stripHash(n.expr || n.right);
                    let ret = { ...n };
                    if (ret.body) ret.body = stripHash(ret.body);
                    if (ret.left) ret.left = stripHash(ret.left);
                    if (ret.right) ret.right = stripHash(ret.right);
                    if (ret.expr) ret.expr = stripHash(ret.expr);
                    return ret;
                };
                
                let cleanModuleAst = stripHash(linkedModuleAst);
                
                let finalBody = [];
                if (cleanModuleAst.type === 'block') {
                    finalBody = cleanModuleAst.body;
                } else if (cleanModuleAst.type === 'SequenceNode') {
                    // Extract the sequenced expressions directly to preserve imperative assignments
                    const flattenSeq = (sq) => {
                        if (!sq) return [];
                        if (sq.type === 'SequenceNode') {
                            return [...flattenSeq(sq.left), ...flattenSeq(sq.right)];
                        }
                        return [sq];
                    };
                    finalBody = flattenSeq(cleanModuleAst);
                } else {
                    finalBody = [cleanModuleAst];
                }
                finalBody.push(exportDict);
                
                this.resolvedFiles.delete(absPath);
                
                return { type: 'ModuleBlock', body: finalBody };
            } else {
                throw new Error("Postfix '@' operator requires a static string literal path.");
            }
        }

        // Recursively traverse normal nodes
        ['left', 'right', 'expr', 'body'].forEach(key => {
            if (node[key]) {
                node[key] = this.link(node[key], baseDir);
            }
        });

        return node;
    }
}
