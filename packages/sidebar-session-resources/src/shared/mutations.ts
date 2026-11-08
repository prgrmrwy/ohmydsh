/** The official first-party mutation vocabulary, shared by log and transcript folds. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function validEditArgs(args: Record<string, unknown>): boolean {
  return typeof args.old_string === 'string' && args.old_string.length > 0
    && typeof args.new_string === 'string' && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

function editorMutationPath(args: Record<string, unknown>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string' && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string') ? path : null
    case 'insert':
      return typeof args.insert_line === 'number' && Number.isInteger(args.insert_line)
        && args.insert_line >= 0 && typeof args.new_str === 'string' ? path : null
    default:
      return null
  }
}

export function mutationPathOfCall(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = argsRaw === '' ? {} : JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default:
      return null
  }
}
