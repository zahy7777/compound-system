// frontend/kernel/event/index.js
function createEvents(call2, kinds) {
  const patterns = Object.fromEntries(Object.entries(kinds["属性"].patterns).map(([name, rule]) => [name, new RegExp(rule.pattern.replaceAll("(?P<", "(?<"))]));
  const loopRule = Object.values(kinds["闭环"].patterns)[0];
  const loopPattern = new RegExp(loopRule.pattern.replaceAll("(?P<", "(?<"));
  const tags = (event, kind) => event.meta.filter((tag) => tag.kind === kind).map((tag) => tag.text);
  const version = (event, changes = {}) => ({ system: { source_id: event.system.source_id, deleted: changes.deleted ?? false }, user: { event: changes.text ?? event.user.event }, meta: structuredClone(changes.meta ?? event.meta) });
  const replace = (meta, kind, texts) => [...meta.filter((tag) => tag.kind !== kind), ...[...new Set(texts)].map((text) => ({ kind, text }))];
  const attribute = (event, name) => {
    const tag = event.meta.find((tag2) => tag2.kind === "属性" && patterns[name].test(tag2.text));
    return tag ? patterns[name].exec(tag.text).groups.value : null;
  };
  const setAttribute = (event, name, value) => [...event.meta.filter((tag) => !(tag.kind === "属性" && patterns[name].test(tag.text))), ...value === null || value === "" ? [] : [{ kind: "属性", text: `${name}:${value}` }]];
  return {
    read: (sets) => call2("/readevent", sets),
    write: (values) => call2("/writeevent", values),
    tags,
    version,
    replace,
    attribute,
    setAttribute,
    create: (text, meta) => ({ system: { source_id: null, deleted: false }, user: { event: text }, meta: structuredClone(meta) }),
    loop: (event) => {
      const text = tags(event, "闭环")[0];
      return text ? { text, ...loopPattern.exec(text).groups } : null;
    },
    loopText: (id, name) => loopRule.template.replace("{id}", id).replace("{name}", name),
    loopTag: (text) => ({ text, ...loopPattern.exec(text).groups }),
    elapsed: (event) => Number(attribute(event, "耗时") ?? 0),
    today: () => {
      const date = /* @__PURE__ */ new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    },
    addElapsed: (event, ms) => setAttribute(event, "耗时", `${Number((Number(attribute(event, "耗时") ?? 0) + ms / 1e3).toFixed(6))}s`)
  };
}

// frontend/kernel/tags_forest/index.js
function createForest(call2) {
  const node = (kind, text) => ({ tag: { kind, text }, children: [] });
  const paths2 = (nodes, prefix = [], indices = []) => nodes.flatMap((value, index) => {
    const path = [...indices, index], tags = [...prefix, value.tag];
    return [{ value, path, tags }, ...paths2(value.children, tags, path)];
  });
  const locate = (forest2, path) => path.reduce((current, index) => current[index].children, forest2);
  const at = (forest2, path) => path.slice(0, -1).reduce((current, index) => current[index].children, forest2)[path.at(-1)];
  const itemOnly = (nodes) => nodes.filter((value) => value.tag.kind === "复利事项").map((value) => ({ tag: { ...value.tag }, children: itemOnly(value.children) }));
  const edit = (forest2, change) => {
    const next = structuredClone(forest2);
    change(next);
    return next;
  };
  return {
    read: (query) => call2("/readforest", query),
    write: (records) => call2("/writeforest", records),
    node,
    paths: paths2,
    at,
    itemOnly,
    defaults: () => ["结果", "待办", "运行", "归档"].map((text) => node("业务区域", text)),
    add: (forest2, path, tag) => edit(forest2, (next) => locate(next, path).push({ tag: { ...tag }, children: [] })),
    rename: (forest2, tag, text) => edit(forest2, (next) => {
      for (const entry of paths2(next)) if (entry.value.tag.kind === tag.kind && entry.value.tag.text === tag.text) entry.value.tag.text = text;
    }),
    remove: (forest2, tag) => edit(forest2, (next) => {
      function prune(nodes) {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (nodes[i].tag.kind === tag.kind && nodes[i].tag.text === tag.text) nodes.splice(i, 1);
          else prune(nodes[i].children);
        }
      }
      prune(next);
    }),
    switchItems: (forest2, items) => edit(forest2, (next) => {
      const root2 = next.find((value) => value.tag.kind === "业务区域" && value.tag.text === "结果");
      root2.children = [...root2.children.filter((value) => value.tag.kind !== "复利事项"), ...structuredClone(items)];
    }),
    workspaceRecord: (memory, forest2, sync = false) => {
      const record = { workspace: { item_template_id: memory.workspace?.item_template_id ?? null, forest: forest2 } };
      const current = memory.item_templates.find((value) => value.id === record.workspace.item_template_id);
      if (sync && current) record.item_templates = [{ id: current.id, deleted: false, name: current.name, forest: itemOnly(forest2.find((value) => value.tag.text === "结果").children) }];
      return record;
    }
  };
}

// frontend/kernel/loop_template/index.js
function createTemplates(call2) {
  return {
    read: (ids) => call2("/readlooptemplate", ids),
    write: (records) => call2("/writelooptemplate", records),
    draft: (name, texts, id = null, deleted = false) => ({ id, deleted, events: texts.map((text) => ({ system: { version_id: null, source_id: null, deleted: false }, user: { event: text }, meta: [{ kind: "闭环", text: name }] })) }),
    name: (record) => record.events[0].meta[0].text
  };
}

// frontend/timer/index.js
function createTimer(call2) {
  let snapshots = /* @__PURE__ */ new Map();
  const remember = (values) => {
    for (const value of values) if (value) snapshots.set(value.key, { ...value, receivedAt: performance.now() });
    return values;
  };
  return {
    read: async (keys) => {
      snapshots = /* @__PURE__ */ new Map();
      return remember(await call2("/readtimer", keys));
    },
    write: async (key, state) => {
      const value = await call2("/writetimer", { key, state });
      remember([value]);
      return value;
    },
    snapshot: (key) => snapshots.get(key),
    elapsed: (key) => {
      const value = snapshots.get(key);
      return value ? value.elapsed_ms + (value.state === "running" ? performance.now() - value.receivedAt : 0) : 0;
    },
    format: (ms) => {
      const seconds = Math.floor(ms / 1e3);
      return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
    }
  };
}

// frontend/shell/projection/index.js
function createProjection(forest2, events2) {
  return { async read() {
    const memory = await forest2.read({ workspace: true, item_templates: null });
    const nodes = memory.workspace?.forest ?? forest2.defaults(), entries = forest2.paths(nodes);
    const results = await events2.read([[], ...entries.map((entry) => entry.tags)]);
    const matches = new Map(entries.map((entry, index) => [JSON.stringify(entry.path), results[index + 1]]));
    function build(value, path, prefix = []) {
      const tags = [...prefix, value.tag], members = matches.get(JSON.stringify(path)) ?? [];
      const children = value.children.map((child, index) => build(child, [...path, index], tags));
      const nested = new Set(children.flatMap((child) => child.members.map((event) => event.system.source_id)));
      let direct = members.filter((event) => !nested.has(event.system.source_id));
      if (value.tag.kind !== "闭环") {
        const loops = /* @__PURE__ */ new Map();
        for (const event of direct) {
          const loop = events2.loop(event);
          if (loop && !loops.has(loop.id)) loops.set(loop.id, loop);
        }
        for (const loop of loops.values()) {
          const grouped = direct.filter((event) => events2.loop(event)?.id === loop.id);
          children.push({ tag: { kind: "闭环", text: loop.text }, path: null, tags: [...tags, { kind: "闭环", text: loop.text }], members: grouped, direct: grouped, children: [], name: loop.name, loop });
        }
        direct = direct.filter((event) => !events2.loop(event));
      }
      const reviewTags = tags.filter((tag) => tag.kind !== "业务区域");
      const review = results[0].filter((event) => reviewTags.every((tag) => event.meta.some((other) => other.kind === tag.kind && other.text === tag.text)));
      return { tag: value.tag, path, tags, members, direct, children, review, name: value.tag.kind === "闭环" ? events2.loopTag(value.tag.text).name : value.tag.text, loop: value.tag.kind === "闭环" ? events2.loopTag(value.tag.text) : null };
    }
    const itemEvents = results[0].filter((event) => events2.tags(event, "复利事项").length).map((event) => {
      let labels = [];
      for (const entry of entries) {
        const items = entry.tags.filter((tag) => tag.kind === "复利事项").map((tag) => tag.text);
        if (items.length > labels.length && items.every((text) => events2.tags(event, "复利事项").includes(text))) labels = items;
      }
      return { event, label: (labels.length ? labels : events2.tags(event, "复利事项")).join(" / ") };
    });
    const todayMs = results[0].filter((event) => events2.attribute(event, "日期") === events2.today()).reduce((total, event) => total + events2.elapsed(event) * 1e3, 0);
    return { areas: nodes.map((value, index) => build(value, [index])), events: results[0], itemEvents, todayMs, views: memory.item_templates, currentView: memory.workspace?.item_template_id ?? null };
  } };
}

// frontend/shell/commands/index.js
function createCommands(events2, forest2, templates2, timer2, keyOf2) {
  const current = async (id) => {
    const [all] = await events2.read([[]]);
    const event = all.find((value) => value.system.source_id === id);
    if (!event) throw new Error("小事已不存在，请刷新");
    return event;
  };
  const memory = async () => {
    const value = await forest2.read({ workspace: true, item_templates: null });
    return { ...value, workspace: value.workspace ?? { item_template_id: null, forest: forest2.defaults() } };
  };
  const saveForest = (value, next, sync) => forest2.write(forest2.workspaceRecord(value, next, sync));
  async function finish(id, archive = false) {
    const event = await current(id), key = keyOf2(id), snapshot = await timer2.write(key, "paused");
    let meta = events2.addElapsed(event, snapshot.elapsed_ms);
    if (archive) meta = events2.replace(meta, "业务区域", ["归档"]);
    await events2.write([events2.version(event, { meta })]);
    try {
      await timer2.write(key, "reset");
    } catch (error) {
      throw new Error(`小事已保存，但计时重置失败。请刷新后重置计时，勿重复结算：${error.message}`);
    }
  }
  return {
    async createEvent(draft, start = false) {
      let record = events2.create(draft.text, draft.meta);
      if (!events2.attribute(record, "日期")) record = { ...record, meta: events2.setAttribute(record, "日期", events2.today()) };
      const result = await events2.write([record]);
      if (start) await timer2.write(keyOf2(result[0].source_id), "running");
    },
    async editEvent(id, draft) {
      const event = await current(id);
      await events2.write([events2.version(event, { text: draft.text, meta: draft.meta ?? event.meta })]);
    },
    async deleteEvent(id) {
      const event = await current(id);
      await events2.write([events2.version(event, { deleted: true })]);
    },
    async setAttribute(id, name, value) {
      const event = await current(id);
      await events2.write([events2.version(event, { meta: events2.setAttribute(event, name, value) })]);
    },
    async startTimer(id) {
      const event = await current(id);
      if (events2.tags(event, "业务区域")[0] !== "运行") await events2.write([events2.version(event, { meta: events2.replace(event.meta, "业务区域", ["运行"]) })]);
      await timer2.write(keyOf2(id), "running");
    },
    pauseTimer: (id) => timer2.write(keyOf2(id), "paused"),
    resumeTimer: (id) => timer2.write(keyOf2(id), "running"),
    finishTimer: (id) => finish(id),
    archiveEvent: (id) => finish(id, true),
    async createItem(path, name) {
      const value = await memory();
      await saveForest(value, forest2.add(value.workspace.forest, path, { kind: "复利事项", text: name }), true);
    },
    async createLoop(name) {
      const value = await memory(), root2 = value.workspace.forest.findIndex((node) => node.tag.kind === "业务区域" && node.tag.text === "待办");
      await saveForest(value, forest2.add(value.workspace.forest, [root2], { kind: "闭环", text: events2.loopText(crypto.randomUUID().replaceAll("-", ""), name) }), false);
    },
    async renameTag(tag, name) {
      const value = await memory(), [all] = await events2.read([[]]);
      const loopId = tag.kind === "闭环" ? events2.loopTag(tag.text).id : null;
      const text = loopId ? events2.loopText(loopId, name) : name;
      const members = all.filter((event) => loopId ? events2.loop(event)?.id === loopId : events2.tags(event, tag.kind).includes(tag.text));
      if (members.length) await events2.write(members.map((event) => events2.version(event, { meta: events2.replace(event.meta, tag.kind, events2.tags(event, tag.kind).map((old) => loopId || old === tag.text ? text : old)) })));
      try {
        await saveForest(value, forest2.rename(value.workspace.forest, tag, text), tag.kind === "复利事项");
      } catch (error) {
        throw new Error(`成员已改名，森林保存失败：${error.message}`);
      }
    },
    async deleteTag(tag, path) {
      const value = await memory(), [all] = await events2.read([[]]);
      const names = tag.kind === "复利事项" ? new Set(forest2.paths([forest2.at(value.workspace.forest, path)]).map((entry) => entry.value.tag.text)) : null;
      const members = all.filter((event) => names ? events2.tags(event, "复利事项").some((name) => names.has(name)) : events2.loop(event)?.id === events2.loopTag(tag.text).id);
      if (members.length) await events2.write(members.map((event) => events2.version(event, { deleted: true })));
      try {
        await saveForest(value, forest2.remove(value.workspace.forest, tag), tag.kind === "复利事项");
      } catch (error) {
        throw new Error(`成员已删除，森林保存失败：${error.message}`);
      }
    },
    async createView(name) {
      const value = await memory(), result = await forest2.write({ item_templates: [{ id: null, deleted: false, name, forest: [] }] });
      await forest2.write({ workspace: { item_template_id: result.item_templates[0].id, forest: forest2.switchItems(value.workspace.forest, []) } });
    },
    async switchView(id) {
      const value = await memory(), selected = value.item_templates.find((record) => record.id === id);
      await forest2.write({ workspace: { item_template_id: id, forest: forest2.switchItems(value.workspace.forest, selected?.forest ?? []) } });
    },
    saveLoopTemplate: (id, name, texts) => templates2.write([templates2.draft(name, texts, id)]),
    async deleteLoopTemplate(id) {
      const [record] = await templates2.read([id]);
      await templates2.write([{ id, deleted: true, events: record.events }]);
    },
    async useLoopTemplate(id) {
      const [record] = await templates2.read([id]), text = events2.loopText(crypto.randomUUID().replaceAll("-", ""), templates2.name(record));
      await events2.write(record.events.map((draft) => events2.create(draft.user.event, [{ kind: "业务区域", text: "待办" }, { kind: "闭环", text }, { kind: "属性", text: `日期:${events2.today()}` }])));
    }
  };
}

// frontend/shell/workspace/icons.js
var paths = {
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  chevron: ["m6 9 6 6 6-6"],
  play: ["M9 5a1 1 0 0 1 1.5-.86l10 6a1 1 0 0 1 0 1.72l-10 6A1 1 0 0 1 9 17Z"],
  pause: ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  stop: ["M5 5h14v14H5z"],
  pencil: ["m16 4 4 4", "M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15Z"],
  trash: ["M3 6h18", "M9 6V4h6v2", "m5 6 1 14h12l1-14", "M10 10v6", "M14 10v6"],
  archive: ["M3 3h18v4H3z", "M5 7v14h14V7", "M10 11h4"],
  chart: ["M5 20v-5", "M12 20V9", "M19 20V3"],
  clipboard: ["M9 5H5v16h14V5h-4", "M9 3h6v4H9z", "M9 12h6", "M9 16h6"],
  folder: ["M3 7V5h6l2 2h10v13H3Z", "M12 10v7", "M8.5 13.5h7"],
  save: ["M19 21H5V3h12l4 4v14Z", "M7 3v6h10V3", "M8 21v-8h8v8"],
  check: ["m5 12 4 4L19 6"],
  rotate: ["M3 10V4", "M3 4h6", "M3 10a9 9 0 1 1 1 8"],
  write: ["M12 20H4V4h8", "m16 3 5 5", "m9 15 1-4L18 3a2.8 2.8 0 0 1 4 4l-8 8Z"]
};
function icon(name, size = 15) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  for (const d of paths[name]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// frontend/shell/workspace/index.js
var el = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== void 0) value.textContent = text;
  if (className) value.className = className;
  return value;
};
function createWorkspace(root2, timer2, keyOf2, events2) {
  let structure, search = "", contextId = 0;
  const contexts = /* @__PURE__ */ new Map(), folded = /* @__PURE__ */ new Set();
  function control(label, action, value = {}, symbol = null, text = "") {
    const button = el("button");
    if (symbol) button.append(icon(symbol));
    if (text) button.append(el("span", text));
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.action = action;
    const id = String(++contextId);
    contexts.set(id, value);
    button.dataset.context = id;
    return button;
  }
  function controls(...buttons) {
    const row = el("div", void 0, "actions");
    row.append(...buttons);
    return row;
  }
  function clock(event) {
    const node = el("span", duration(timer2.elapsed(keyOf2(event.system.source_id))), "timer-display");
    node.dataset.key = keyOf2(event.system.source_id);
    return node;
  }
  function eventCard(event) {
    const id = event.system.source_id, area = events2.tags(event, "业务区域")[0], snapshot = timer2.snapshot(keyOf2(id));
    const active = snapshot && (snapshot.state === "running" || snapshot.elapsed_ms > 0);
    const card = el("article", void 0, `event ${area === "运行" ? `running ${snapshot?.state === "running" ? "" : "paused"}` : ""}`);
    card.dataset.source = id;
    const body = el("div", void 0, "event-content");
    body.append(el("div", event.user.event || "尚未填写正文", "event-body"));
    if (area === "归档") body.append(el("small", `${duration(events2.elapsed(event) * 1e3)}${events2.attribute(event, "评分") ? ` · ${events2.attribute(event, "评分")}分` : ""}`, "badges"));
    const actions = controls();
    if (area === "运行") card.append(body, clock(event));
    else card.append(body);
    if (active && area === "运行") actions.append(control(snapshot.state === "running" ? "暂停" : "继续", snapshot.state === "running" ? "pause" : "resume", { id }, snapshot.state === "running" ? "pause" : "play"));
    else if (area !== "归档") actions.append(control("运行", "start", { id }, "play"));
    if (area === "运行") actions.append(control("归档", "archive", { id }, "archive"));
    if (area === "归档") actions.append(control("恢复运行", "start", { id }, "rotate"));
    if (area === "结果") actions.append(control("修改耗时", "duration", { event }, null, duration(events2.elapsed(event) * 1e3)), control("评分", "score", { event }, null, events2.attribute(event, "评分") ?? "未评分"));
    actions.append(control("修改事实", "edit", { event }, "pencil"), control("删除事实", "delete", { id }, "trash"));
    card.append(actions);
    return card;
  }
  function duration(ms) {
    const seconds = Math.floor(ms / 1e3), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
    return `${hours ? `${hours}时` : ""}${hours || minutes ? `${minutes}分` : ""}${seconds % 60}秒`;
  }
  function resultTimers() {
    const strip = el("section", void 0, "running-strip");
    strip.setAttribute("aria-label", "结果计时条");
    for (const { event, label } of structure.itemEvents) {
      const id = event.system.source_id, snapshot = timer2.snapshot(keyOf2(id));
      if (!snapshot || snapshot.state === "paused" && !snapshot.elapsed_ms) continue;
      const running = snapshot.state === "running", row = el("div");
      row.dataset.timerSource = id;
      row.dataset.timerState = snapshot.state;
      const caption = el("div", void 0, "result-timer-label");
      caption.append(el("span", void 0, running ? "live-dot" : "paused-dot"), el("span", event.user.event || label), el("small", running ? "计时中" : "已暂停"));
      row.append(caption, clock(event), controls(control(running ? "暂停" : "继续", running ? "pause" : "resume", { id }, running ? "pause" : "play", running ? "暂停" : "继续"), control("结束", "finish", { id }, "stop", "结束")));
      strip.append(row);
    }
    strip.hidden = !strip.children.length;
    return strip;
  }
  function branch(node, area) {
    const isLoop = node.tag.kind === "闭环", section = el("section", void 0, isLoop ? "loop" : "item");
    section.dataset[isLoop ? "loop" : "item"] = isLoop ? node.loop.id : node.name;
    const foldKey = JSON.stringify(node.tags), head = el("div", void 0, "group-head");
    const fold = control(folded.has(foldKey) ? "展开" : "收起", "fold", { foldKey }, "chevron");
    fold.className = folded.has(foldKey) ? "fold closed" : "fold";
    if (isLoop) {
      const name = control(node.name, "fold", { foldKey }, "chevron", node.name);
      name.className = "loop-name";
      name.setAttribute("aria-expanded", !folded.has(foldKey));
      head.append(name, el("small", `${node.members.length} 件`, "count"));
    } else {
      const name = control(node.name, "fold", { foldKey }, null, node.name);
      name.className = "branch-name";
      const records = controls(control("记录一条", "record", { tags: node.tags }, "write", "记录一条"), control("开始计时", "record-start", { tags: node.tags }, "play"));
      records.classList.add("branch-actions");
      const review2 = control("回顾投入", "review", { events: node.review, name: node.name }, "chart");
      review2.className = "branch-time";
      head.append(fold, name, records, review2);
    }
    const tools = controls();
    if (isLoop && area === "待办") tools.append(control("在闭环下新增待办", "record", { tags: node.tags }, "plus"));
    if (!isLoop) tools.append(control("新增子事项", "add-item", { path: node.path }, "plus"));
    if (!isLoop || area === "待办") tools.append(control(isLoop ? "重命名闭环" : "重命名事项", "rename", { node }, "pencil"), control(isLoop ? "删除闭环组" : "删除事项分支", "delete-tag", { node }, "minus"));
    tools.classList.add(isLoop ? "loop-actions" : "structure-actions");
    head.append(tools);
    const content = el("div", void 0, "branch-content");
    content.hidden = folded.has(foldKey);
    content.append(...node.direct.map(eventCard), ...node.children.map((child) => branch(child, area)));
    if (!node.direct.length && !node.children.length && isLoop && area === "待办") content.append(el("p", "这个闭环下还没有小事。", "empty"));
    section.append(head, content);
    if (search && !section.textContent.toLowerCase().includes(search.toLowerCase())) section.hidden = true;
    return section;
  }
  function areaPanel(area) {
    const section = el("section", void 0, "area");
    section.dataset.area = area.name;
    const heading = el("div", void 0, "section-heading"), title = el("div", void 0, "stage-title");
    title.append(el(area.name === "结果" ? "h2" : "h3", area.name === "结果" ? "结果." : area.name));
    heading.append(title);
    if (area.name === "结果") {
      const tools = controls(), summary = el("span", void 0, "result-summary");
      summary.append(el("small", "今日投入"), el("strong", duration(structure.todayMs)));
      const review2 = control("投入回顾", "review", { events: structure.events, name: "全部投入" }, "chart", "投入回顾"), add = control("新增根事项", "add-item", { path: area.path }, "plus", "新增根事项");
      add.className = "primary";
      tools.append(summary, review2, add);
      heading.append(tools);
    }
    if (area.name === "待办") title.append(control("新增待办", "record", { tags: area.tags }, "plus"), control("选择或管理模板", "templates", {}, "clipboard"), control("新增闭环", "add-loop", {}, "folder"));
    if (area.name === "运行") title.append(el("span", void 0, "live-dot"), control("快速运行", "record-start", { tags: area.tags }, "play"));
    if (area.name !== "结果") heading.append(el("small", `${area.members.length} 件`, "count"));
    section.append(heading, ...area.direct.map(eventCard), ...area.children.map((child) => branch(child, area.name)));
    if (!area.direct.length && !area.children.length) section.append(el("p", area.name === "结果" ? "从一个值得长期投入的事项开始。" : area.name === "运行" ? "暂无运行中的小事" : area.name === "待办" ? "暂无待办小事" : "暂无匹配的归档", "empty"));
    return section;
  }
  function render(next = structure) {
    structure = next;
    contexts.clear();
    root2.replaceChildren();
    const left = el("div", void 0, "result-page"), toolbar = el("section", void 0, "workspace-controls");
    toolbar.append(el("small", "COMPOUND", "eyebrow"), el("h1", "让每一次投入积累下来"));
    const row = el("div", void 0, "toolbar"), select = el("select");
    select.id = "view-select";
    select.setAttribute("aria-label", "事项视图");
    select.append(new Option("默认视图", ""));
    for (const view of structure.views) select.append(new Option(view.name, String(view.id)));
    select.value = structure.currentView === null ? "" : String(structure.currentView);
    const input = el("input");
    input.id = "search";
    input.placeholder = "搜索事项或小事";
    input.setAttribute("aria-label", "搜索");
    input.value = search;
    row.append(select, control("新增视图", "add-view", {}, "plus"), input);
    toolbar.append(row);
    left.append(toolbar, resultTimers(), areaPanel(structure.areas.find((area) => area.name === "结果")));
    const right = el("section", void 0, "small-page");
    right.append(el("h2", "小事."));
    for (const name of ["运行", "待办", "归档"]) right.append(areaPanel(structure.areas.find((area) => area.name === name)));
    root2.append(left, right);
    if (search) for (const card of root2.querySelectorAll(".event")) card.hidden = !card.textContent.toLowerCase().includes(search.toLowerCase());
  }
  function tick() {
    for (const node of root2.querySelectorAll(".timer-display")) node.textContent = duration(timer2.elapsed(node.dataset.key));
  }
  function status(text, error = false) {
    const node = document.querySelector("#message");
    node.textContent = text;
    node.className = error ? "error" : "";
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.querySelector(".dialog-error").textContent = error ? text : "";
  }
  function busy(value) {
    document.querySelectorAll("button,input,select,textarea").forEach((node) => {
      node.disabled = value;
    });
  }
  function modal(title) {
    const dialog = el("dialog"), form = el("form"), heading = el("div", void 0, "dialog-heading");
    dialog.setAttribute("aria-label", title);
    heading.append(el("h2", title));
    const close = el("button");
    close.append(icon("close"));
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    close.onclick = () => dialog.close();
    heading.append(close);
    form.append(heading);
    const error = el("p", "", "dialog-error");
    error.setAttribute("role", "alert");
    form.append(error);
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    return { dialog, form, show: () => dialog.showModal() };
  }
  function nameDialog(title, initial, submit, numeric = false) {
    const { dialog, form, show } = modal(title), input = el("input");
    input.value = initial;
    input.required = !numeric;
    input.setAttribute("aria-label", title);
    if (numeric) {
      input.type = "number";
      input.min = "0";
      input.step = "0.000001";
    }
    const footer = el("footer"), cancel = el("button", "取消");
    cancel.type = "button";
    cancel.onclick = () => dialog.close();
    footer.append(cancel, el("button", "确定"));
    form.append(input, footer);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (await submit(input.value.trim())) dialog.close();
    };
    show();
    input.focus();
  }
  function confirm(title, submit) {
    const { dialog, form, show } = modal(title);
    const footer = el("footer"), cancel = el("button", "取消");
    cancel.type = "button";
    cancel.onclick = () => dialog.close();
    footer.append(cancel, el("button", "确定"));
    form.append(footer);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (await submit()) dialog.close();
    };
    show();
  }
  function rating(title, submit) {
    const { dialog, form, show } = modal(title), row = el("div", void 0, "rating-options");
    const captions = ["很吃力", "不太顺", "一般", "挺好", "很满意"];
    for (let i = 1; i <= 5; i++) {
      const button = el("button", `${i} · ${captions[i - 1]}`);
      button.type = "button";
      button.onclick = async () => {
        if (await submit(String(i))) dialog.close();
      };
      row.append(button);
    }
    const none = el("button", "不评分，完成");
    none.type = "button";
    none.onclick = async () => {
      if (await submit(null)) dialog.close();
    };
    form.append(row, none);
    form.onsubmit = (event) => event.preventDefault();
    show();
  }
  function editor(initial, submit, start = false, editing = false) {
    const { dialog, form, show } = modal(editing ? "修改事实" : start ? "开始一件事" : "写下一条事实");
    dialog.classList.add("capture");
    form.append(el("p", initial.meta.filter((tag) => tag.kind !== "属性").map((tag) => tag.kind === "闭环" ? events2.loopTag(tag.text).name : tag.text).join(" / "), "context"));
    const text = el("textarea");
    text.setAttribute("aria-label", "小事正文");
    text.value = initial.text;
    text.placeholder = "写下刚才做了什么，或接下来准备做什么。";
    text.rows = 6;
    const details = el("details"), attributes = el("textarea");
    attributes.setAttribute("aria-label", "属性标签");
    attributes.rows = 3;
    attributes.value = initial.meta.filter((tag) => tag.kind === "属性").map((tag) => tag.text).join("\n");
    details.append(el("summary", "属性"), attributes, el("small", "每行一个已登记属性：评分、耗时、日期、备注。"));
    const footer = el("footer"), save = el("button", editing ? "保存修改" : start ? "保存并开始" : "保存并选择评分");
    footer.append(save);
    form.append(el("p", "01 / 事实", "eyebrow"), text, details, footer);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const draft = { text: text.value, meta: [...initial.meta.filter((tag) => tag.kind !== "属性"), ...attributes.value.split("\n").filter(Boolean).map((value) => ({ kind: "属性", text: value }))] };
      const commit = async (score) => {
        if (score !== void 0) draft.meta = events2.setAttribute({ meta: draft.meta }, "评分", score);
        if (await submit(draft)) {
          dialog.close();
          return true;
        }
        return false;
      };
      if (editing || start) await commit(void 0);
      else rating("选择评分", commit);
    };
    show();
    text.focus();
  }
  function review(records, name) {
    const { dialog, form, show } = modal(`${name} · 投入回顾`);
    const total = records.reduce((sum, event) => sum + events2.elapsed(event), 0);
    form.append(el("strong", timer2.format(total * 1e3), "review-total"), el("p", `${records.length} 条小事`));
    for (const event of records) {
      const row = el("div", void 0, "review-row");
      row.append(el("span", event.user.event || "尚未填写正文"), el("span", `${events2.elapsed(event)}s`));
      form.append(row);
    }
    form.onsubmit = (event) => event.preventDefault();
    show();
  }
  function templateManager(records, capabilities) {
    const { dialog, form, show } = modal("选择模板");
    dialog.classList.add("template-dialog");
    const heading = form.querySelector(".dialog-heading"), headingTitle = el("div");
    headingTitle.append(el("small", "闭环模板"), heading.querySelector("h2"));
    heading.prepend(headingTitle);
    const picker = el("div", void 0, "template-picker"), management = el("div", void 0, "template-manage");
    for (const record of records) {
      const button = el("button");
      button.type = "button";
      button.setAttribute("aria-label", `${record.events[0].meta[0].text} · ${record.events.length} 条`);
      button.append(el("strong", record.events[0].meta[0].text), el("small", `${record.events.length} 项`));
      button.onclick = async () => {
        if (await capabilities.use(record.id)) dialog.close();
      };
      picker.append(button);
    }
    function draft(record = null) {
      let name = record?.events[0].meta[0].text ?? "", texts = record?.events.map((event) => event.user.event) ?? [], folded2 = false;
      const section = el("section", void 0, "template-draft");
      section.dataset.template = record?.id ?? "new";
      const head = el("div", void 0, "group-head"), content = el("div", void 0, "template-items");
      const label = el("button", void 0, "loop-name"), count = el("small", "", "count"), nameInput = el("input");
      label.type = "button";
      nameInput.setAttribute("aria-label", "模板名称");
      nameInput.placeholder = "闭环模板名称";
      nameInput.value = name;
      function title() {
        label.replaceChildren(icon("chevron"), el("span", name || "未命名模板"));
        label.setAttribute("aria-expanded", !folded2);
        count.textContent = `${texts.length} 件`;
      }
      function rename() {
        label.hidden = true;
        nameInput.hidden = false;
        nameInput.value = name;
        nameInput.focus();
      }
      function acceptName() {
        name = nameInput.value.trim();
        label.hidden = false;
        nameInput.hidden = true;
        title();
      }
      nameInput.onchange = acceptName;
      nameInput.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          acceptName();
        }
      };
      label.onclick = () => {
        folded2 = !folded2;
        content.hidden = folded2;
        title();
      };
      const buttons = controls(), more = el("button"), change = el("button"), remove = el("button");
      for (const [button, symbol, caption] of [[more, "plus", "+ 增加模板事项"], [change, "pencil", "重命名模板"], [remove, "trash", "删除模板"]]) {
        button.type = "button";
        button.append(icon(symbol));
        button.setAttribute("aria-label", caption);
        button.title = caption;
      }
      change.onclick = rename;
      function rows(editIndex = -1) {
        content.replaceChildren();
        texts.forEach((text, index) => {
          const row = el("div", void 0, "draft-row"), textNode = el("span", text || "空正文", "template-item-content"), input = el("input");
          input.value = text;
          input.setAttribute("aria-label", "模板小事正文");
          input.hidden = index !== editIndex;
          textNode.hidden = !input.hidden;
          const edit = el("button"), drop = el("button");
          edit.type = drop.type = "button";
          edit.append(icon(index === editIndex ? "check" : "pencil"));
          drop.append(icon("trash"));
          edit.setAttribute("aria-label", "修改模板事项");
          drop.setAttribute("aria-label", "删除模板事项");
          input.oninput = () => {
            texts[index] = input.value;
          };
          input.onkeydown = (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              rows();
            }
          };
          edit.onclick = () => rows(index === editIndex ? -1 : index);
          drop.onclick = () => {
            texts.splice(index, 1);
            rows();
            title();
          };
          row.append(textNode, input, controls(edit, drop));
          content.append(row);
          if (!input.hidden) input.focus();
        });
        if (!texts.length) content.append(el("p", "还没有事项，点击右侧加号添加。", "empty"));
        const save = el("button", void 0, "template-save");
        save.type = "button";
        save.append(icon("save"), el("span", "保存模板"));
        save.setAttribute("aria-label", "保存模板");
        save.onclick = async () => {
          acceptName();
          if (await capabilities.save(record?.id ?? null, name, texts)) {
            dialog.close();
            dialog.remove();
            await capabilities.reopen();
          }
        };
        content.append(save);
      }
      more.onclick = () => {
        texts.push("");
        folded2 = false;
        content.hidden = false;
        rows(texts.length - 1);
        title();
      };
      remove.onclick = () => {
        if (!record) section.remove();
        else confirm("删除这个闭环模板？", async () => {
          if (await capabilities.remove(record.id)) {
            dialog.close();
            dialog.remove();
            await capabilities.reopen();
            return true;
          }
          return false;
        });
      };
      buttons.classList.add("template-group-actions");
      buttons.append(more, change, remove);
      head.append(label, nameInput, count, buttons);
      section.append(head, content);
      management.append(section);
      nameInput.hidden = true;
      title();
      rows();
      if (!record) rename();
    }
    const manageHead = el("div", void 0, "template-manage-heading"), add = el("button");
    add.type = "button";
    add.setAttribute("aria-label", "+ 增加模板");
    add.append(icon("plus"), el("span", "增加模板"));
    add.onclick = () => draft();
    manageHead.append(el("h3", "管理模板"), add);
    const scroll = el("div", void 0, "template-scroll");
    scroll.append(picker, manageHead, management);
    form.append(scroll);
    records.forEach(draft);
    form.onsubmit = (event) => event.preventDefault();
    show();
  }
  return { render, tick, busy, status, nameDialog, confirm, rating, editor, review, templateManager, context: (id) => contexts.get(id), fold: (key) => {
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    render();
  }, search: (value) => {
    search = value;
    const focused = document.activeElement?.id === "search";
    render();
    if (focused) {
      const input = root2.querySelector("#search");
      input.focus();
      input.setSelectionRange(value.length, value.length);
    }
  } };
}

// frontend/shell/input/index.js
function bindInput(root2, commands2, workspace2, refresh2, events2, templates2) {
  let saving = false;
  async function run(action) {
    if (saving) return false;
    saving = true;
    workspace2.busy(true);
    workspace2.status("正在保存");
    try {
      await action();
      await refresh2();
      workspace2.status("已保存");
      return true;
    } catch (error) {
      let message = error.message;
      try {
        await refresh2();
      } catch (readError) {
        message += `；刷新失败：${readError.message}`;
      }
      workspace2.status(message, true);
      return false;
    } finally {
      saving = false;
      workspace2.busy(false);
    }
  }
  async function openTemplates() {
    try {
      workspace2.templateManager(await templates2.read(null), { use: (id) => run(() => commands2.useLoopTemplate(id)), save: (id, name, texts) => run(() => commands2.saveLoopTemplate(id, name, texts)), remove: (id) => run(() => commands2.deleteLoopTemplate(id)), reopen: openTemplates });
    } catch (error) {
      workspace2.status(error.message, true);
    }
  }
  root2.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || saving) return;
    const value = workspace2.context(button.dataset.context), action = button.dataset.action;
    switch (action) {
      case "fold":
        workspace2.fold(value.foldKey);
        break;
      case "add-view":
        workspace2.nameDialog("新增事项视图", "", (name) => run(() => commands2.createView(name)));
        break;
      case "add-item":
        workspace2.nameDialog("复利事项名称", "", (name) => run(() => commands2.createItem(value.path, name)));
        break;
      case "add-loop":
        workspace2.nameDialog("闭环名称", "", (name) => run(() => commands2.createLoop(name)));
        break;
      case "rename":
        workspace2.nameDialog("重命名", value.node.name, (name) => run(() => commands2.renameTag(value.node.tag, name)));
        break;
      case "delete-tag":
        workspace2.confirm(`删除「${value.node.name}」及全部区域成员？`, () => run(() => commands2.deleteTag(value.node.tag, value.node.path)));
        break;
      case "record":
      case "record-start": {
        const start = action === "record-start", meta = start ? events2.replace(value.tags, "业务区域", ["运行"]) : value.tags;
        workspace2.editor({ text: "", meta }, (draft) => run(() => commands2.createEvent(draft, start)), start);
        break;
      }
      case "edit":
        workspace2.editor({ text: value.event.user.event, meta: value.event.meta }, (draft) => run(() => commands2.editEvent(value.event.system.source_id, draft)), false, true);
        break;
      case "delete":
        workspace2.confirm("删除这条小事？", () => run(() => commands2.deleteEvent(value.id)));
        break;
      case "start":
        void run(() => commands2.startTimer(value.id));
        break;
      case "pause":
        void run(() => commands2.pauseTimer(value.id));
        break;
      case "resume":
        void run(() => commands2.resumeTimer(value.id));
        break;
      case "finish":
        void run(() => commands2.finishTimer(value.id));
        break;
      case "archive":
        void run(() => commands2.archiveEvent(value.id));
        break;
      case "duration":
        workspace2.nameDialog("修改耗时（秒）", String(events2.elapsed(value.event)), (seconds) => run(() => commands2.setAttribute(value.event.system.source_id, "耗时", seconds === "" ? null : `${seconds}s`)), true);
        break;
      case "score":
        workspace2.rating("选择评分", (score) => run(() => commands2.setAttribute(value.event.system.source_id, "评分", score)));
        break;
      case "review":
        workspace2.review(value.events, value.name);
        break;
      case "templates":
        void openTemplates();
        break;
    }
  });
  root2.addEventListener("change", (event) => {
    if (event.target.id === "view-select") void run(() => commands2.switchView(event.target.value ? Number(event.target.value) : null));
  });
  root2.addEventListener("input", (event) => {
    if (event.target.id === "search") workspace2.search(event.target.value);
  });
}

// frontend/main.js
async function call(path, value) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
var keyOf = (id) => String(id);
var events = createEvents(call, JSON.parse(document.querySelector("#protocol").textContent));
var forest = createForest(call);
var templates = createTemplates(call);
var timer = createTimer(call);
var projection = createProjection(forest, events);
var commands = createCommands(events, forest, templates, timer, keyOf);
var root = document.querySelector("#workspace");
var workspace = createWorkspace(root, timer, keyOf, events);
async function refresh() {
  const structure = await projection.read();
  await timer.read(structure.events.map((event) => keyOf(event.system.source_id)));
  workspace.render(structure);
}
bindInput(root, commands, workspace, refresh, events, templates);
setInterval(workspace.tick, 250);
try {
  await refresh();
  workspace.status("已读取");
} catch (error) {
  workspace.status(error.message, true);
}
