/** Minimal locale service for client-entry tests: records dictionaries and binds a translator. */
export function fakeLocale(active: 'zh' | 'en' = 'en') {
  const dictionaries = new Map<string, Record<'zh' | 'en', Record<string, string>>>()
  return {
    dictionaries,
    service: {
      register(namespace: string, dicts: Record<'zh' | 'en', Record<string, string>>): () => void {
        dictionaries.set(namespace, dicts)
        return () => {}
      },
      bind(namespace: string): (key: string) => string {
        return (key: string) => dictionaries.get(namespace)?.[active][key] ?? key
      },
    },
  }
}
