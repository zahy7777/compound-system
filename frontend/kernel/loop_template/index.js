export function createTemplates(call) {
  return {
    read: ids => call('/readlooptemplate', ids), write: records => call('/writelooptemplate', records),
    draft: (name, texts, id = null, deleted = false) => ({id, deleted, events: texts.map(text => ({system: {version_id: null, source_id: null, deleted: false}, user: {event: text}, meta: [{kind: '闭环', text: name}]}))}),
    name: record => record.events[0].meta[0].text,
  }
}
