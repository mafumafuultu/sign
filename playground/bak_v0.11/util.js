export function isUnitNode(node) {
  if (!node) return false;
  if (node.type === 'unit') return true;
  if (node.value === '_' || node.name === '_' || node.text === '_' || node.op === '_') return true;
  if (node.type === 'number' && (node.value === 'nan' || node.value === null || Number.isNaN(node.value))) return true;
  if (String(node.value).toLowerCase() === 'nan') return true;
  return false;
}
