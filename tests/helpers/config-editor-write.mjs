// Replicates the profile-patch document edit of DSH 0.2.0's settings writer:
// @deepseek-ai/dsh-config-editor@0.2.0-rc.2 `edit()` (src/index.ts L111-136, tag
// dsh-v0.2.0-rc.2). It rewrites the LAST same-id override row's config in place,
// or appends a new row at the end of the document. Kept byte-for-byte with that
// logic so sync's region ownership is tested against the real writer's shape.
import { isMap, isSeq, parseDocument, Scalar, visit } from 'yaml'
export function configEditorWrite(text, entry, next) {
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: v => v }] })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  document.contents.flow = false
  const index = document.contents.items.findLastIndex((item, i) => isMap(item)
    && document.getIn([i, 'id']) === entry.id && !item.has('insert')
    && (!item.has('name') || document.getIn([i, 'name']) === entry.name))
  if (index < 0) document.add(document.createNode({ id: entry.id, name: entry.name, config: next }))
  else document.setIn([index, 'config'], document.createNode(next))
  visit(document, { Map(_k, node) {
    if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
    const e = new Scalar(node.get('__jsExpr')); e.tag = 'tag:yaml.org,2002:js'; return e
  } })
  return String(document)
}
