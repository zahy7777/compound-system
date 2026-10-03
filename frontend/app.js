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
  const node = (kind, text) => ({ tag: { kind, text }, is_fold: false, children: [] });
  const paths2 = (nodes, prefix = [], indices = []) => nodes.flatMap((value, index) => {
    const path = [...indices, index], tags = [...prefix, value.tag];
    return [{ value, path, tags }, ...paths2(value.children, tags, path)];
  });
  const locate = (forest2, path) => path.reduce((current, index) => current[index].children, forest2);
  const at = (forest2, path) => path.slice(0, -1).reduce((current, index) => current[index].children, forest2)[path.at(-1)];
  const itemOnly = (nodes) => nodes.filter((value) => value.tag.kind === "复利事项").map((value) => ({ tag: { ...value.tag }, is_fold: value.is_fold ?? false, children: itemOnly(value.children) }));
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
    add: (forest2, path, tag) => edit(forest2, (next) => locate(next, path).push(node(tag.kind, tag.text))),
    setFold: (forest2, tags, isFold, order = []) => edit(forest2, (next) => {
      const find = (tags2) => paths2(next).find((entry) => JSON.stringify(entry.tags) === JSON.stringify(tags2))?.value;
      let target = find(tags);
      if (!target && tags.at(-1).kind === "闭环") {
        const parent = find(tags.slice(0, -1));
        if (!parent) throw new Error("分支已不存在，请刷新");
        const loops = order.map((tag) => parent.children.find((child) => child.tag.kind === "闭环" && child.tag.text === tag.text) ?? node(tag.kind, tag.text));
        parent.children = [...parent.children.filter((child) => child.tag.kind !== "闭环"), ...loops];
        target = find(tags);
      }
      if (!target) throw new Error("分支已不存在，请刷新");
      target.is_fold = isFold;
    }),
    move: (forest2, from, to, position) => {
      if (from.every((index, depth) => to[depth] === index)) throw new Error("不能移动到自己或自己的后代");
      const next = structuredClone(forest2), source = at(next, from), target = at(next, to);
      const before = paths2(next).find((entry) => entry.value === source).tags;
      const parent = locate(next, from.slice(0, -1)), destination = position === "inside" ? target.children : locate(next, to.slice(0, -1));
      parent.splice(parent.indexOf(source), 1);
      destination.splice(position === "inside" ? destination.length : destination.indexOf(target) + (position === "after" ? 1 : 0), 0, source);
      return { forest: next, before, after: paths2(next).find((entry) => entry.value === source).tags };
    },
    reorderLoops: (forest2, area, tags, source, target, position) => edit(forest2, (next) => {
      const root2 = next.find((value) => value.tag.kind === "业务区域" && value.tag.text === area);
      const ordered = tags.map((tag) => root2.children.find((value) => value.tag.kind === "闭环" && value.tag.text === tag.text) ?? node(tag.kind, tag.text));
      const moved = ordered.splice(ordered.findIndex((value) => value.tag.text === source), 1)[0];
      ordered.splice(ordered.findIndex((value) => value.tag.text === target) + (position === "after" ? 1 : 0), 0, moved);
      root2.children = [...root2.children.filter((value) => value.tag.kind !== "闭环"), ...ordered];
    }),
    rename: (forest2, tag, text) => edit(forest2, (next) => {
      for (const entry of paths2(next)) if (entry.value.tag.kind === tag.kind && entry.value.tag.text === tag.text) entry.value.tag.text = text;
    }),
    remove: (forest2, path, tag) => edit(forest2, (next) => {
      const parent = locate(next, path.slice(0, -1)), target = parent[path.at(-1)];
      if (target?.tag.kind !== tag.kind || target.tag.text !== tag.text) throw new Error("分支已变化，请刷新");
      parent.splice(path.at(-1), 1);
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

// frontend/kernel/slice/index.js
function createSlices(call2) {
  function check(names) {
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || !name || name.trim() !== name || name.includes("\n") || name.includes("\r") || name === "小事") || new Set(names).size !== names.length) throw new Error("切片名称不能为空、重复、含首尾空白或换行，也不能使用“小事”");
  }
  return { read: () => call2("/readslice", null), write: (names) => {
    check(names);
    return call2("/writeslice", names);
  }, check };
}

// frontend/plugin/speech/audio.js
function createAudio(onChunk, onError) {
  if (!globalThis.AudioContext || !globalThis.AudioWorkletNode) throw new Error("当前浏览器不支持实时录音，请使用键盘输入");
  const context = new AudioContext();
  const resumed = context.resume();
  void resumed.catch(() => {
  });
  let media, source, node, cancelled = false, flush;
  function cancel() {
    cancelled = true;
    media?.getTracks().forEach((track) => track.stop());
    media = null;
    node?.disconnect();
    source?.disconnect();
    if (context.state !== "closed") void context.close().catch(() => {
    });
    flush?.reject(new Error("收音已取消"));
    flush = null;
  }
  async function start() {
    await resumed;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    media = stream;
    await context.audioWorklet.addModule(new URL("speech/processor.js", import.meta.url));
    if (cancelled) return;
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "speech-pcm");
    node.port.onmessage = ({ data }) => {
      if (cancelled) return;
      if (data instanceof ArrayBuffer) onChunk(data);
      else if (data === "flushed") {
        flush?.resolve();
        flush = null;
      }
    };
    node.onprocessorerror = () => onError("麦克风音频处理失败，草稿保留");
    source.connect(node);
    node.connect(context.destination);
  }
  function record() {
    node.port.postMessage("record");
  }
  async function finish() {
    media?.getTracks().forEach((track) => track.stop());
    media = null;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        flush = null;
        reject(new Error("音频结束未确认，草稿保留"));
      }, 2e3);
      flush = { resolve: () => {
        clearTimeout(timeout);
        resolve();
      }, reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      } };
      node.port.postMessage("flush");
    });
    node.disconnect();
    source.disconnect();
    await context.close();
  }
  return { context, get source() {
    return source;
  }, start, record, finish, cancel };
}

// frontend/plugin/speech/silence.js
function detectSilence(context, source, onLevel, onSilence) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame, speakingSince = 0, heard = false, lastVoice = performance.now(), noise = 3e-3;
  function tick() {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length), now = performance.now();
    if (rms > Math.max(0.012, noise * 3)) {
      if (!speakingSince) speakingSince = now;
      if (now - speakingSince >= 200) heard = true;
      lastVoice = now;
    } else {
      speakingSince = 0;
      if (!heard) noise = noise * 0.98 + Math.min(rms, 0.01) * 0.02;
    }
    const silence = now - lastVoice;
    onLevel(Math.min(1, rms * 12), heard && silence >= 1500 ? Math.max(0, Math.ceil((2500 - silence) / 1e3)) : 0);
    if (heard && silence >= 2500) {
      onSilence();
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  tick();
  return () => {
    cancelAnimationFrame(frame);
    source.disconnect(analyser);
  };
}

// frontend/plugin/speech/index.js
function createSpeech({ onText, onState, onComplete, onError, request, openSocket }) {
  let socket, audio, stopMeter, deadline, controller, generation = 0, state = "idle";
  function phase(value, detail = {}) {
    state = value;
    onState(value, detail);
  }
  function cancel() {
    generation++;
    clearTimeout(deadline);
    controller?.abort();
    controller = null;
    stopMeter?.();
    stopMeter = null;
    audio?.cancel();
    audio = null;
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      socket = null;
    }
    phase("idle");
  }
  function fail(message) {
    cancel();
    onError(message);
  }
  async function stop() {
    if (state === "finishing") return;
    if (state !== "recording") {
      cancel();
      onComplete();
      return;
    }
    const current = generation;
    phase("finishing");
    stopMeter?.();
    stopMeter = null;
    clearTimeout(deadline);
    deadline = setTimeout(() => fail("识别结束未确认，草稿保留，请校对后保存"), 12e3);
    try {
      await audio.finish();
      if (current === generation) socket.send("stop");
    } catch (error) {
      if (current === generation) fail(error.message);
    }
  }
  async function start() {
    cancel();
    const current = generation;
    phase("connecting");
    try {
      audio = createAudio((chunk) => {
        if (current !== generation || !["recording", "finishing"].includes(state)) return;
        if (socket?.readyState !== WebSocket.OPEN) {
          fail("语音连接中断，草稿保留");
          return;
        }
        if (socket.bufferedAmount > 64e3) {
          fail("语音网络拥堵，草稿保留，请重新录音");
          return;
        }
        socket.send(chunk);
      }, (message) => {
        if (current === generation) fail(message);
      });
      const response = await request("/speech/config"), config = await response.json();
      if (current !== generation) return;
      if (!response.ok) throw new Error(config.error || "无法读取语音配置");
      if (!config.configured) {
        cancel();
        phase("idle", { unconfigured: true });
        return;
      }
      const recorder = audio;
      await recorder.start();
      if (current !== generation) return;
      controller = new AbortController();
      const connected = await openSocket("/speech/stream", { signal: controller.signal });
      if (current !== generation) {
        connected.close();
        return;
      }
      socket = connected;
      deadline = setTimeout(() => fail("语音连接超时，仍可键盘输入"), 1e4);
      socket.onmessage = (event) => {
        if (current !== generation) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready" && state === "connecting") {
            clearTimeout(deadline);
            phase("recording");
            recorder.record();
            stopMeter = detectSilence(
              recorder.context,
              recorder.source,
              (level, countdown) => onState("recording", { level, countdown }),
              stop
            );
          }
          if (message.type === "transcript") onText(message.text);
          if (message.type === "completed") {
            onText(message.text);
            cancel();
            onComplete();
          }
          if (message.type === "error") fail(message.message);
        } catch {
          fail("语音返回无效消息，草稿保留");
        }
      };
      socket.onerror = socket.onclose = () => {
        if (current === generation) fail("语音连接中断，草稿保留，仍可键盘输入");
      };
    } catch (error) {
      if (current === generation) fail(error.message);
    }
  }
  return { start, stop, cancel };
}

// frontend/timer/index.js
function createTimer(call2) {
  let snapshots = /* @__PURE__ */ new Map();
  let revision = 0;
  const remember = (values) => {
    for (const value of values) if (value) snapshots.set(value.key, { ...value, receivedAt: performance.now() });
    return values;
  };
  return {
    read: async (keys) => {
      const current = ++revision, values = await call2("/readtimer", keys);
      if (current === revision) {
        snapshots = /* @__PURE__ */ new Map();
        remember(values);
      }
      return values;
    },
    write: async (key, state) => {
      const value = await call2("/writetimer", { key, state });
      revision++;
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

// frontend/shell/projection/dates.js
function datesInRange(range, today) {
  if (!range || range === "all") return null;
  const [year, month, day] = today.split("-").map(Number), end = new Date(year, month - 1, day, 12), start = new Date(end);
  if (range === "week") start.setDate(day - (end.getDay() + 6) % 7);
  if (range === "month") start.setDate(1);
  if (range === "quarter") {
    start.setDate(1);
    start.setMonth(Math.floor((month - 1) / 3) * 3);
  }
  if (range === "week") {
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  }
  if (range === "month") end.setMonth(month, 0);
  if (range === "quarter") end.setMonth(start.getMonth() + 3, 0);
  const dates = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
  return dates;
}

// frontend/shell/projection/slices.js
function sliceProjection(structure2, names, events2, totals) {
  const known = new Set(names), sliceOf = (event) => events2.tags(event, "区域切片")[0] ?? null;
  const missingSlices = [...new Set(structure2.events.filter((event) => !events2.tags(event, "业务区域").includes("结果")).map(sliceOf).filter((name) => name !== null && !known.has(name)))];
  function panel(slice) {
    const matches = (event) => slice === null ? !known.has(sliceOf(event)) : sliceOf(event) === slice;
    function filter(node) {
      const members = node.members.filter(matches), children = node.children.flatMap((child) => {
        const projected = filter(child);
        return projected.members.length || slice === null && child.path !== null && !child.members.length ? [projected] : [];
      });
      return { ...node, members, direct: node.direct.filter(matches), review: node.review?.filter(matches) ?? members, totals: totals(members), children };
    }
    return { slice, name: slice ?? "小事", areas: structure2.areas.filter((area) => area.name !== "结果").map(filter) };
  }
  return { ...structure2, slicePanels: [null, ...names].map(panel), missingSlices };
}

// frontend/shell/projection/index.js
function createProjection(forest2, events2, slices2) {
  return { async read(ranges = {}) {
    const [memory, names] = await Promise.all([forest2.read({ workspace: true, item_templates: null }), slices2.read()]);
    const nodes = memory.workspace?.forest ?? forest2.defaults(), entries = forest2.paths(nodes);
    const queries = [[]], groups = entries.map((entry) => {
      const area = entry.tags.find((tag) => tag.kind === "业务区域")?.text, dates = datesInRange(ranges[area], events2.today());
      const sets = dates ? dates.map((date) => events2.setAttribute({ meta: entry.tags }, "日期", date)) : [entry.tags];
      return sets.map((tags) => {
        queries.push(tags);
        return queries.length - 1;
      });
    });
    const results = await events2.read(queries);
    const matches = new Map(entries.map((entry, index) => [JSON.stringify(entry.path), [...new Map(groups[index].flatMap((i) => results[i]).map((event) => [event.system.source_id, event])).values()].sort((a, b) => a.system.source_id - b.system.source_id)]));
    const totals = (members) => ({ elapsedMs: members.reduce((sum, event) => sum + events2.elapsed(event) * 1e3, 0), score: members.reduce((sum, event) => sum + Number(events2.attribute(event, "评分") ?? 0), 0) });
    function build(value, path, prefix = []) {
      const tags = [...prefix, value.tag], members = matches.get(JSON.stringify(path)) ?? [];
      const children = value.children.map((child, index) => build(child, [...path, index], tags));
      const nested = new Set(children.flatMap((child) => child.members.map((event) => event.system.source_id)));
      let direct = members.filter((event) => !nested.has(event.system.source_id));
      if (value.tag.kind !== "闭环" && !tags.some((tag) => tag.kind === "业务区域" && tag.text === "结果")) {
        const loops = /* @__PURE__ */ new Map();
        for (const event of direct) {
          const loop = events2.loop(event);
          if (loop && !loops.has(loop.id)) loops.set(loop.id, loop);
        }
        for (const loop of loops.values()) {
          const grouped = direct.filter((event) => events2.loop(event)?.id === loop.id);
          children.push({ tag: { kind: "闭环", text: loop.text }, is_fold: false, path: null, tags: [...tags, { kind: "闭环", text: loop.text }], members: grouped, direct: grouped, children: [], totals: totals(grouped), name: loop.name, loop });
        }
        direct = direct.filter((event) => !events2.loop(event));
      }
      if (tags.some((tag) => tag.kind === "业务区域" && tag.text === "结果")) direct = direct.filter((event) => event.user.event !== "");
      const loopOrder = children.filter((child) => child.tag.kind === "闭环").map((child) => child.tag);
      for (const child of children) child.loopOrder = loopOrder;
      return { tag: value.tag, is_fold: value.is_fold ?? false, path, tags, members, direct, children, review: members, totals: totals(members), name: value.tag.kind === "闭环" ? events2.loopTag(value.tag.text).name : value.tag.text, loop: value.tag.kind === "闭环" ? events2.loopTag(value.tag.text) : null };
    }
    const resultRoot = nodes.findIndex((node) => node.tag.kind === "业务区域" && node.tag.text === "结果");
    const resultEvents = (matches.get(JSON.stringify([resultRoot])) ?? []).map((event) => {
      let labels = [];
      for (const entry of entries) {
        const items = entry.tags.filter((tag) => tag.kind === "复利事项").map((tag) => tag.text);
        if (items.length > labels.length && items.every((text) => events2.tags(event, "复利事项").includes(text))) labels = items;
      }
      return { event, label: (labels.length ? labels : events2.tags(event, "复利事项")).join(" / ") };
    });
    return sliceProjection({ areas: nodes.map((value, index) => build(value, [index])), events: results[0], resultEvents, views: memory.item_templates, currentView: memory.workspace?.item_template_id ?? null }, names, events2, totals);
  } };
}

// frontend/shell/commands/slices.js
function sliceCommands(events2, slices2) {
  async function replace(name, target, names) {
    slices2.check(names);
    const [members] = await events2.read([[{ kind: "区域切片", text: name }]]);
    if (members.length) await events2.write(members.map((event) => events2.version(event, { meta: events2.replace(event.meta, "区域切片", target === null ? [] : [target]) })));
    try {
      await slices2.write(names);
    } catch (error) {
      throw new Error(`小事已更新，切片列表保存失败：${error.message}`);
    }
  }
  return {
    async createSlice(after, name) {
      const names = await slices2.read(), index = after === null ? -1 : names.indexOf(after);
      if (after !== null && index === -1) throw new Error("切片已不存在，请刷新");
      names.splice(index + 1, 0, name);
      await slices2.write(names);
    },
    async renameSlice(name, target) {
      const names = await slices2.read(), index = names.indexOf(name);
      if (index === -1) throw new Error("切片已不存在，请刷新");
      names[index] = target;
      await replace(name, target, names);
    },
    async deleteSlice(name) {
      const names = await slices2.read();
      if (!names.includes(name)) throw new Error("切片已不存在，请刷新");
      await replace(name, null, names.filter((value) => value !== name));
    }
  };
}

// frontend/shell/commands/index.js
function createCommands(events2, forest2, templates2, timer2, keyOf2, slices2) {
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
  async function writeTimer(id, state) {
    const key = keyOf2(id);
    if (state === "running") {
      const [all] = await events2.read([[]]);
      const snapshots = await timer2.read(all.map((event) => keyOf2(event.system.source_id)));
      for (const snapshot of snapshots) {
        if (snapshot?.state === "running" && snapshot.key !== key) await timer2.write(snapshot.key, "paused");
      }
    }
    return timer2.write(key, state);
  }
  async function writeEvent(id, changes, timerState = null) {
    const previous = id === null ? null : await current(id);
    const elapsedMs = changes.elapsedMs ?? (timerState === "reset" ? (await timer2.write(keyOf2(id), "paused")).elapsed_ms : void 0);
    let record = previous ? events2.version(previous, changes) : events2.create(changes.text, changes.meta);
    if (changes.slice !== void 0) record.meta = events2.replace(record.meta, "区域切片", changes.slice === null ? [] : [changes.slice]);
    if (!previous && !events2.attribute(record, "日期")) record.meta = events2.setAttribute(record, "日期", events2.today());
    if (elapsedMs !== void 0) record.meta = events2.addElapsed({ ...record, meta: events2.setAttribute(record, "耗时", `${events2.elapsed(previous)}s`) }, elapsedMs);
    if (previous && timerState === "running") await writeTimer(id, "running");
    const [identity] = await events2.write([record]);
    if (timerState && !(previous && timerState === "running")) {
      try {
        await writeTimer(identity.source_id, timerState);
      } catch (error) {
        throw new Error(`事实已保存，计时状态写入失败，勿重复提交：${error.message}`);
      }
    }
    return identity;
  }
  return {
    ...sliceCommands(events2, slices2),
    writeEvent,
    async run(id) {
      const event = await current(id);
      return writeEvent(id, { meta: events2.replace(event.meta, "业务区域", ["运行"]) }, "running");
    },
    async archive(id) {
      const event = await current(id);
      const prepared = await timer2.write(keyOf2(id), "paused");
      return writeEvent(id, { meta: events2.replace(event.meta, "业务区域", ["归档"]), elapsedMs: prepared.elapsed_ms }, "reset");
    },
    async setFold(tags, isFold, order) {
      const value = await memory();
      await saveForest(value, forest2.setFold(value.workspace.forest, tags, isFold, order), tags.at(-1).kind === "复利事项");
    },
    writeTimer,
    async writeEventTags(ids, replacements, slice) {
      const [all] = await events2.read([[]]), selected = new Set(ids);
      const records = all.filter((event) => selected.has(event.system.source_id)).map((event) => {
        let meta = event.meta;
        for (const [kind, texts] of Object.entries(replacements)) meta = events2.replace(meta, kind, texts);
        if (slice !== void 0) meta = events2.replace(meta, "区域切片", slice === null ? [] : [slice]);
        return events2.version(event, { meta });
      });
      if (records.length) await events2.write(records);
    },
    async moveItem(from, to, position) {
      const value = await memory(), moved = forest2.move(value.workspace.forest, from, to, position);
      const [members] = await events2.read([moved.before]);
      const before = moved.before.filter((tag) => tag.kind === "复利事项").map((tag) => tag.text), after = moved.after.filter((tag) => tag.kind === "复利事项").map((tag) => tag.text);
      if (members.length) await events2.write(members.map((event) => events2.version(event, { meta: events2.replace(event.meta, "复利事项", [...after, ...events2.tags(event, "复利事项").filter((text) => !before.includes(text))]) })));
      try {
        await saveForest(value, moved.forest, true);
      } catch (error) {
        throw new Error(`${members.length ? "成员已迁移，" : ""}森林保存失败：${error.message}`);
      }
    },
    async reorderLoops(area, tags, source, target, position) {
      const value = await memory();
      await saveForest(value, forest2.reorderLoops(value.workspace.forest, area, tags, source, target, position), false);
    },
    async createItem(path, name) {
      const value = await memory();
      await saveForest(value, forest2.add(value.workspace.forest, path, { kind: "复利事项", text: name }), true);
    },
    async createLoop(name, draft, slice) {
      const text = events2.loopText(crypto.randomUUID().replaceAll("-", ""), name);
      if (draft) return writeEvent(null, { ...draft, meta: events2.replace(draft.meta, "闭环", [text]), slice });
      const value = await memory(), root2 = value.workspace.forest.findIndex((node) => node.tag.kind === "业务区域" && node.tag.text === "待办");
      await saveForest(value, forest2.add(value.workspace.forest, [root2], { kind: "闭环", text }), false);
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
    async deleteTag(tag, path, area, slice) {
      const value = await memory(), [all] = await events2.read([[]]);
      const names = tag.kind === "复利事项" ? new Set(forest2.paths([forest2.at(value.workspace.forest, path)]).map((entry) => entry.value.tag.text)) : null;
      const known = slice === null ? new Set(await slices2.read()) : null;
      const areaMembers = all.filter((event) => names ? events2.tags(event, "复利事项").some((name) => names.has(name)) : events2.tags(event, "业务区域").includes(area) && events2.loop(event)?.id === events2.loopTag(tag.text).id);
      const members = areaMembers.filter((event) => names || slice === void 0 || (slice === null ? !known.has(events2.tags(event, "区域切片")[0]) : events2.tags(event, "区域切片")[0] === slice));
      const next = path === null || areaMembers.length !== members.length ? null : forest2.remove(value.workspace.forest, path, tag);
      if (members.length) await events2.write(members.map((event) => events2.version(event, { deleted: true })));
      if (next) {
        try {
          await saveForest(value, next, tag.kind === "复利事项");
        } catch (error) {
          throw new Error(`成员已删除，森林保存失败：${error.message}`);
        }
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
    async useLoopTemplate(id, slice) {
      const [record] = await templates2.read([id]), text = events2.loopText(crypto.randomUUID().replaceAll("-", ""), templates2.name(record));
      await events2.write(record.events.map((draft) => events2.create(draft.user.event, [{ kind: "业务区域", text: "待办" }, { kind: "闭环", text }, { kind: "属性", text: `日期:${events2.today()}` }, ...slice ? [{ kind: "区域切片", text: slice }] : []])));
    }
  };
}

// frontend/shell/workspace/component/icons.js
var paths = {
  settings: ["M9 3h6l1 3 3 1v6l-3 1-1 3H9l-1-3-3-1V7l3-1Z", "M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0"],
  mic: ["M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z", "M5 10v2a7 7 0 0 0 14 0v-2", "M12 19v3", "M8 22h8"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  chevron: ["m6 9 6 6 6-6"],
  play: ["M9 5a1 1 0 0 1 1.5-.86l10 6a1 1 0 0 1 0 1.72l-10 6A1 1 0 0 1 9 17Z"],
  pause: ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  stop: ["M5 5h14v14H5z"],
  pencil: ["m16 4 4 4", "M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15Z"],
  archive: ["M3 3h18v4H3z", "M5 7v14h14V7", "M10 11h4"],
  chart: ["M5 20v-5", "M12 20V9", "M19 20V3"],
  clipboard: ["M9 5H5v16h14V5h-4", "M9 3h6v4H9z", "M9 12h6", "M9 16h6"],
  folder: ["M3 7V5h6l2 2h10v13H3Z", "M12 10v7", "M8.5 13.5h7"],
  save: ["M19 21H5V3h12l4 4v14Z", "M7 3v6h10V3", "M8 21v-8h8v8"],
  check: ["m5 12 4 4L19 6"],
  rotate: ["M3 10V4", "M3 4h6", "M3 10a9 9 0 1 1 1 8"],
  return: ["M21 10V4", "M21 4h-6", "M21 10a9 9 0 1 0-1 8"],
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

// frontend/shell/workspace/component/button.js
var paperSlots = /* @__PURE__ */ new Set(["event-body", "event-tools", "branch-time", "actions", "count", "empty", "result-summary", "timer-display", "result-timer-label", "review-total", "review-row", "context", "voice-status", "card-question", "measured-time", "loop-name", "icon-button", "slice-warning"]);
var el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== void 0) node.textContent = text;
  if (className) node.className = className;
  const slot = className?.split(" ").find((name) => paperSlots.has(name)) ?? (["h1", "h2", "h3"].includes(tag) ? tag : null);
  if (slot) {
    node.dataset.paper = slot;
    if (text !== void 0) node.dataset.paperKey = String(text);
  }
  return node;
};
function iconButton({ icon: symbol, label, text = "", onClick }) {
  const button = el("button", void 0, "icon-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  if (symbol) button.append(icon(symbol));
  if (text) button.append(el("span", text));
  if (onClick) button.onclick = onClick;
  return button;
}
function controls(...buttons) {
  const row = el("div", void 0, "actions");
  row.append(...buttons);
  return row;
}

// frontend/shell/workspace/component/event_row.js
function eventRow({ body, badge = "", stats = "", clock, running = false, paused = false, buttons = {} }) {
  const row = el("article", void 0, `event${running ? ` running${paused ? " paused" : ""}` : ""}`);
  const content = el("div", void 0, "event-content");
  content.append(typeof body === "string" ? el("div", body, "event-body") : body);
  if (badge) {
    const label = el("span", badge, "event-loop");
    label.title = badge;
    content.append(label);
  }
  const tools = el("div", void 0, "event-tools"), details = el("small", stats, "event-stats");
  if (clock) tools.append(clock);
  details.hidden = !stats;
  tools.append(details);
  const actions = controls();
  for (const name of ["play", "archive", "todo", "run", "edit", "delete"]) {
    if (buttons[name]) {
      buttons[name].dataset.slot = name;
      actions.append(buttons[name]);
    }
  }
  tools.append(actions);
  row.append(content, tools);
  return row;
}

// frontend/shell/workspace/component/loop_group.js
function loopGroup({ key, label, count, buttons = [], collapsed = false, onToggle }) {
  const section = el("section", void 0, "loop"), head = el("div", void 0, "group-head");
  section.dataset.visualKey = `loop:${key}`;
  const hue2 = [...key].reduce((hash2, char) => hash2 * 31 + char.charCodeAt(0) >>> 0, 0) % 360;
  section.style.setProperty("--loop-hue", hue2);
  const tab = el("div", void 0, "loop-tab"), content = el("div", void 0, "branch-content");
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  head.setAttribute("aria-label", "折叠闭环");
  label.classList.add("loop-name");
  count.classList.add("count");
  tab.append(label, count, controls(...buttons));
  head.append(tab);
  section.append(head, content);
  function setCollapsed(value) {
    section.classList.toggle("collapsed", value);
    content.hidden = value;
    head.setAttribute("aria-expanded", !value);
    head.setAttribute("aria-label", value ? "展开闭环" : "折叠闭环");
  }
  function toggle(event) {
    if (event.target.closest("button,input")) return;
    if (event.type === "keydown") {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
    }
    onToggle();
  }
  head.onclick = toggle;
  head.onkeydown = toggle;
  setCollapsed(collapsed);
  return { section, head, content, setCollapsed };
}

// frontend/shell/workspace/component/date_range/index.js
function dateRange(area, value) {
  const select = el("select", void 0, "date-range");
  select.dataset.dateArea = area;
  select.setAttribute("aria-label", `${area}日期范围`);
  for (const [key, name] of [["today", "今天"], ["week", "本周"], ["month", "本月"], ["quarter", "本季度"], ["all", "全部"]]) select.append(new Option(name, key));
  select.value = value;
  return select;
}

// frontend/shell/workspace/component/capture/cards.js
function textCard(draft, next, editing) {
  const card = el("section", void 0, "capture-card text-card"), orb = el("div", void 0, "voice-orb");
  orb.append(icon("mic", 40));
  orb.setAttribute("aria-hidden", "true");
  const recognized = el("div", "", "recognized-text");
  recognized.hidden = true;
  recognized.setAttribute("aria-label", "语音识别正文");
  const text = el("textarea");
  text.setAttribute("aria-label", "小事正文");
  text.rows = 5;
  text.value = draft.text;
  text.placeholder = "写下这次做了什么，或接下来准备做什么。";
  text.oninput = () => {
    draft.keyboard = text.value;
    draft.text = draft.speech + text.value;
  };
  const details = el("details"), attributes = el("textarea");
  attributes.setAttribute("aria-label", "属性标签");
  attributes.rows = 3;
  attributes.value = draft.attributes;
  attributes.oninput = () => {
    draft.attributes = attributes.value;
  };
  details.append(el("summary", "属性"), attributes, el("small", "每行一个已登记属性：日期、评分、耗时、备注。"));
  const save = el("button", editing ? "保存修改" : "保存", "primary");
  save.type = "button";
  save.onclick = next;
  const box = el("div", void 0, "mixed-text");
  box.append(recognized, text);
  card.append(orb, el("p", "直接输入文字，留下这件事。", "voice-status"), box, details, save);
  return card;
}
function durationCard(draft, next) {
  const card = el("section", void 0, "capture-card duration-card"), options = el("div", void 0, "duration-options"), custom = el("div", void 0, "duration-custom");
  card.append(el("p", "这次投入了多久？", "card-question"));
  for (const minutes of [1, 3, 5, 10, 15, 20, 30]) {
    const button = el("button");
    button.type = "button";
    button.setAttribute("aria-label", `${minutes} 分钟`);
    button.append(el("strong", String(minutes)), el("span", "分钟"));
    button.onclick = () => {
      draft.seconds = minutes * 60;
      void next();
    };
    options.append(button);
  }
  const customButton = el("button", "自定义");
  customButton.type = "button";
  customButton.onclick = () => {
    options.hidden = true;
    custom.hidden = false;
    input.focus();
  };
  options.append(customButton);
  const input = el("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.000001";
  input.value = String(draft.seconds / 60);
  input.setAttribute("aria-label", "自定义耗时（分钟）");
  const ruler = el("input");
  ruler.type = "range";
  ruler.min = "0";
  ruler.max = "180";
  ruler.step = "1";
  ruler.value = String(draft.seconds / 60);
  ruler.setAttribute("aria-label", "时长尺");
  input.oninput = () => {
    ruler.value = input.value;
  };
  ruler.oninput = () => {
    input.value = ruler.value;
  };
  const confirm = el("button", "确认耗时", "primary");
  confirm.type = "button";
  confirm.onclick = () => {
    if (!input.reportValidity()) return;
    draft.seconds = Number((Number(input.value) * 60).toFixed(6));
    void next();
  };
  custom.append(el("p", "自定义投入（分钟）", "card-question"), ruler, input, confirm);
  custom.hidden = true;
  const none = el("button", "不记录耗时", "text-button");
  none.type = "button";
  none.onclick = () => {
    draft.seconds = 0;
    void next();
  };
  card.append(options, custom, none);
  return card;
}
function scoreCard(draft, next) {
  const card = el("section", void 0, "capture-card score-card"), options = el("div", void 0, "score-options"), captions = ["很吃力", "不太顺", "一般", "挺好", "很满意"];
  card.append(el("p", "这次投入感觉如何？", "card-question"));
  for (let score = 1; score <= 5; score++) {
    const button = el("button");
    button.type = "button";
    button.setAttribute("aria-label", `${score} · ${captions[score - 1]}`);
    button.append(el("strong", String(score)), el("span", captions[score - 1]));
    button.onclick = () => {
      draft.score = String(score);
      void next();
    };
    options.append(button);
  }
  const none = el("button", "不评分，完成", "text-button");
  none.type = "button";
  none.onclick = () => {
    draft.score = null;
    void next();
  };
  card.append(options, none);
  return card;
}

// frontend/shell/workspace/component/capture/index.js
function capture({ dialog, form, show }, initial, { steps, editing = false, context = "", measured = "", createSpeech: createSpeech2 }, submit) {
  const draft = { ...initial, keyboard: initial.text, speech: "" }, factories = { text: textCard, duration: durationCard, score: scoreCard }, cards = {}, progress = el("div", void 0, "capture-steps");
  let index = 0, advancing = false, voiceState = "idle", speech2;
  function confirm() {
    if (advancing || voiceState === "finishing") return;
    if (voiceState === "recording" || voiceState === "connecting") speech2.stop();
    else void next();
  }
  async function next() {
    if (advancing || !dialog.open) return;
    advancing = true;
    try {
      if (index < steps.length - 1) {
        index++;
        render();
        return;
      }
      if (await submit({ ...draft })) dialog.close();
    } finally {
      advancing = false;
    }
  }
  for (const name of Object.keys(factories)) cards[name] = factories[name](draft, name === "text" ? confirm : next, editing);
  const text = cards.text.querySelector("textarea"), recognized = cards.text.querySelector(".recognized-text"), status = cards.text.querySelector(".voice-status");
  if (createSpeech2 && steps.includes("text")) {
    speech2 = createSpeech2({
      onText(value) {
        draft.speech = value;
        draft.text = value + draft.keyboard;
        recognized.textContent = value;
        recognized.hidden = !value;
      },
      onState(state, { level = 0, countdown = 0, unconfigured = false } = {}) {
        voiceState = state;
        cards.text.querySelector(".voice-orb").style.setProperty("--voice-scale", 1 + level * 0.2);
        status.textContent = unconfigured ? "语音未配置，直接键盘输入。" : countdown ? `说完了？${countdown} 秒后确认` : { idle: "可以键盘补充，Enter 确认。", connecting: "正在连接麦克风…", recording: "正在听，也可以键盘补充；Enter 确认。", finishing: "正在确认最后的文字…" }[state];
      },
      onComplete() {
        void next();
      },
      onError(message) {
        status.textContent = message;
        status.setAttribute("role", "alert");
      }
    });
    dialog.addEventListener("close", () => speech2.cancel(), { once: true });
  }
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      confirm();
    }
  });
  form.append(el("p", context, "context"), progress, ...measured ? [el("p", measured, "measured-time")] : [], ...Object.values(cards));
  function render() {
    progress.replaceChildren(...steps.map((name, step) => el("span", `${step + 1} ${{ text: "正文", duration: "耗时", score: "评分" }[name]}`, step === index ? "current" : "")));
    for (const [name, card] of Object.entries(cards)) card.hidden = name !== steps[index];
    cards[steps[index]].querySelector("textarea,button")?.focus();
  }
  dialog.classList.add("capture");
  form.onsubmit = (event) => {
    event.preventDefault();
  };
  show();
  render();
  if (speech2 && !editing) void speech2.start();
}

// frontend/shell/workspace/presentation/index.js
function shortcutPage(mode, structure2, { areaPanel, resultTimers, settings }) {
  const panel = el("section", void 0, "shortcut-page"), header = el("div", void 0, "section-heading");
  header.append(el("h2", mode === "running" ? "运行." : "待办."));
  if (settings) header.append(iconButton({ icon: "settings", label: "快捷键设置", onClick: settings }));
  panel.append(header);
  if (mode === "running") panel.append(resultTimers());
  panel.append(areaPanel(structure2.areas.find((area) => area.name === (mode === "running" ? "运行" : "待办"))));
  return panel;
}

// frontend/shell/workspace/desktop_settings/index.js
async function shortcutSettings(modal, desktop) {
  const { dialog, form, show } = modal("快捷键设置"), error = form.querySelector(".dialog-error");
  show();
  try {
    const config = await desktop.readSettings(), draft = { ...config.shortcuts };
    form.append(el("p", `当前环境：${config.environment}。点击后按下组合键。`, "context"));
    for (const [name, title] of [["running", "运行界面"], ["todo", "待办界面"]]) {
      const row = el("label", title, "shortcut-setting"), button = el("button", draft[name]);
      button.type = "button";
      button.onclick = () => {
        button.textContent = "请按快捷键…";
        button.dataset.recording = "true";
        button.focus();
      };
      button.onkeydown = (event) => {
        if (!button.dataset.recording || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          delete button.dataset.recording;
          button.textContent = draft[name];
          return;
        }
        if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
        const key = event.code === "Space" ? "Space" : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key;
        draft[name] = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super", key].filter(Boolean).join("+");
        button.textContent = draft[name];
        delete button.dataset.recording;
      };
      row.append(button);
      form.append(row);
    }
    const save = el("button", "保存快捷键", "primary");
    save.type = "submit";
    form.append(save);
    form.onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await desktop.saveSettings(draft);
        dialog.close();
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        save.disabled = false;
      }
    };
  } catch (failure) {
    error.textContent = failure.message;
  }
}

// frontend/shell/workspace/mobile/index.js
var sections = ["结果", "运行", "待办", "归档"];
function navigateBySwipe(page, selected, select) {
  let start;
  page.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (event.pointerType !== "touch" || !event.isPrimary || event.button !== 0 || !(target instanceof Element) || target.closest('.mobile-nav,button,a,input,select,textarea,[role="button"],[contenteditable="true"]')) {
      start = null;
      return;
    }
    start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  });
  page.addEventListener("pointerup", (event) => {
    const origin = start;
    start = null;
    if (!origin || event.pointerId !== origin.pointerId) return;
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    const next = sections[sections.indexOf(selected) + (dx < 0 ? 1 : -1)];
    if (next) select(next);
  });
  page.addEventListener("pointercancel", () => {
    start = null;
  });
}
function mobilePage({ selected, select, logout, result, timers, area }) {
  const page = el("section", void 0, "mobile-page"), header = el("header", void 0, "mobile-heading"), nav = el("nav", void 0, "mobile-nav");
  navigateBySwipe(page, selected, select);
  const brand = el("strong", "Compound");
  brand.dataset.paper = "brand";
  header.append(brand);
  if (logout) header.append(iconButton({ icon: "return", label: "退出登录", onClick: logout }));
  nav.setAttribute("aria-label", "手机分区");
  for (const name of sections) {
    const button = el("button", name);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected === name));
    button.onclick = () => select(name);
    nav.append(button);
  }
  page.append(header, nav);
  if (selected === "结果") page.append(result());
  else {
    if (selected === "运行") page.append(timers());
    page.append(area());
  }
  return page;
}

// frontend/shell/workspace/index.js
function createWorkspace(root2, timer2, keyOf2, events2, createSpeech2, { presentation: presentation2 = "full", desktop = null, logout = null } = {}) {
  let structure2, search = "", contextId = 0, requestFold;
  let mobileArea = "待办";
  const contexts = /* @__PURE__ */ new Map();
  const ranges = { 结果: "today", 归档: "today" };
  const sliceLayout = new ResizeObserver(() => {
    const container = root2.querySelector(".slice-panels");
    if (!container) return;
    const panels = Array.from(container.children);
    for (const panel of panels) panel.style.gridColumn = "";
    const style = getComputedStyle(container), columns = style.gridTemplateColumns.split(" ").length, gap = parseFloat(style.columnGap);
    panels.forEach((panel, index) => {
      panel.style.gridColumn = String(index % columns + 1);
      panel.style.gridRowEnd = `span ${Math.ceil(panel.getBoundingClientRect().height + gap)}`;
    });
  });
  function register(value) {
    const id = String(++contextId);
    contexts.set(id, value);
    return id;
  }
  function draggable(element2, value, drop = false) {
    const id = register(value);
    element2.draggable = true;
    element2.dataset.drag = id;
    if (drop) element2.dataset.drop = id;
  }
  function dropTarget(element2, value) {
    element2.dataset.drop = register(value);
  }
  function control(label, action, value = {}, symbol = null, text = "") {
    const button = iconButton({ icon: symbol, label, text });
    button.dataset.action = action;
    button.dataset.context = register(value);
    return button;
  }
  function clock(event) {
    const node = el("span", duration(timer2.elapsed(keyOf2(event.system.source_id))), "timer-display");
    node.dataset.key = keyOf2(event.system.source_id);
    return node;
  }
  function eventCard(event, hostTags, slice) {
    const id = event.system.source_id, area = events2.tags(event, "业务区域")[0], snapshot = timer2.snapshot(keyOf2(id));
    const active = snapshot && (snapshot.state === "running" || snapshot.elapsed_ms > 0);
    const buttons = { edit: control("修改事实", "edit", { event }, "pencil"), delete: control("删除事实", "delete", { id }, "minus") };
    if (area === "结果" || area === "运行") buttons.play = control(active && snapshot.state === "running" ? "暂停" : active ? "继续" : "开始计时", active && snapshot.state === "running" ? "pause" : "start", { id }, active && snapshot.state === "running" ? "pause" : "play");
    if (area === "待办") buttons.play = control("开始计时", "run", { id, event }, "play");
    if (area === "归档") buttons.run = control("移入运行", "run", { id, event }, "rotate");
    if (area === "运行") {
      buttons.archive = control("归档", "archive", { id, event }, "archive");
      buttons.todo = control("返回待办", "todo", { id, event }, "return");
    }
    const score = events2.attribute(event, "评分");
    const card = eventRow({ body: event.user.event || "尚未填写正文", badge: area === "结果" ? events2.loop(event)?.name ?? "" : "", stats: [events2.elapsed(event) > 0 ? duration(events2.elapsed(event) * 1e3) : "", score ? `${score}分` : ""].filter(Boolean).join(" · "), clock: area === "运行" ? clock(event) : null, running: area === "运行", paused: snapshot?.state !== "running", buttons });
    draggable(card, { kind: "event", area, slice, ids: [id], items: hostTags.filter((tag) => tag.kind === "复利事项").map((tag) => tag.text), loop: events2.loop(event)?.text });
    card.dataset.source = id;
    card.dataset.visualKey = `event:${id}`;
    return card;
  }
  function duration(ms) {
    const seconds = Math.floor(ms / 1e3), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
    return `${hours ? `${hours}时` : ""}${hours || minutes ? `${minutes}分` : ""}${seconds % 60}秒`;
  }
  function resultTimers() {
    const strip = el("section", void 0, "running-strip");
    strip.setAttribute("aria-label", "结果计时条");
    for (const { event, label } of structure2.resultEvents) {
      const id = event.system.source_id, snapshot = timer2.snapshot(keyOf2(id));
      if (!snapshot || snapshot.state === "paused" && !snapshot.elapsed_ms) continue;
      const running = snapshot.state === "running", row = el("div");
      row.dataset.timerSource = id;
      row.dataset.timerState = snapshot.state;
      const caption = el("div", void 0, "result-timer-label");
      caption.append(el("span", void 0, running ? "live-dot" : "paused-dot"), el("span", event.user.event || label), el("small", running ? "计时中" : "已暂停"));
      row.append(caption, clock(event), controls(control(running ? "暂停" : "继续", running ? "pause" : "resume", { id }, running ? "pause" : "play", running ? "暂停" : "继续"), control("结束", "finish", { id, event }, "stop", "结束")));
      strip.append(row);
    }
    strip.hidden = !strip.children.length;
    return strip;
  }
  function branch(node, area, slice) {
    const foldChange = { tags: node.tags, isFold: !node.is_fold, order: node.loopOrder };
    if (node.tag.kind === "闭环") {
      const buttons = area === "待办" ? [control("在闭环下新增待办", "record", { tags: node.tags, slice }, "plus"), control("重命名闭环", "rename", { node }, "pencil"), control("删除闭环组", "delete-tag", { node, slice }, "minus")] : [];
      const { section: section2, head: head2, content: content2 } = loopGroup({ key: node.loop.id, label: el("span", node.name), count: el("small", `${node.members.length} 件`), buttons, collapsed: node.is_fold, onToggle: () => requestFold(foldChange) });
      if (area !== "结果") draggable(head2, { kind: "loop", area, slice, tag: node.tag, ids: node.members.map((event) => event.system.source_id), order: node.loopOrder }, true);
      section2.dataset.loop = node.loop.id;
      content2.append(...node.direct.map((event) => eventCard(event, node.tags, slice)), ...node.children.map((child) => branch(child, area, slice)));
      if (!node.direct.length && !node.children.length && area === "待办") content2.append(el("p", "这个闭环下还没有小事。", "empty"));
      if (search && !section2.textContent.toLowerCase().includes(search.toLowerCase())) section2.hidden = true;
      return section2;
    }
    const section = el("section", void 0, "item"), head = el("div", void 0, "group-head");
    section.dataset.item = node.name;
    section.dataset.visualKey = `item:${node.tags.map((tag) => `${tag.kind}:${tag.text}`).join("/")}`;
    if (area === "结果") draggable(head, { kind: "item", area, path: node.path, items: node.tags.filter((tag) => tag.kind === "复利事项").map((tag) => tag.text) }, true);
    const fold = control(node.is_fold ? "展开" : "收起", "fold", foldChange, "chevron");
    fold.className = node.is_fold ? "fold closed" : "fold";
    const name = control(node.name, "fold", foldChange, null, node.name);
    name.className = "branch-name";
    name.dataset.paper = "branch-name";
    const records = controls(control("开始计时", "record-start", { tags: node.tags }, "play"), control("记录一条", "record", { tags: node.tags }, "write", "记录一条"));
    records.classList.add("branch-actions");
    delete records.dataset.paper;
    const review2 = control("回顾投入", "review", { events: node.review, name: node.name }, "chart");
    const totals = el("span", void 0, "branch-totals");
    totals.setAttribute("aria-label", "事项总耗时总评分");
    totals.append(el("span", duration(node.totals.elapsedMs)), el("span", `${node.totals.score}分`));
    const stats = el("div", void 0, "branch-time");
    stats.append(totals, review2);
    head.append(fold, name, records, stats);
    const tools = controls(control("新增子事项", "add-item", { path: node.path }, "plus"), control("重命名事项", "rename", { node }, "pencil"), control("删除事项分支", "delete-tag", { node }, "minus"));
    tools.classList.add("structure-actions");
    head.append(tools);
    const content = el("div", void 0, "branch-content");
    content.hidden = node.is_fold;
    content.append(...node.direct.map((event) => eventCard(event, node.tags, slice)), ...node.children.map((child) => branch(child, area, slice)));
    section.append(head, content);
    if (search && !section.textContent.toLowerCase().includes(search.toLowerCase())) section.hidden = true;
    return section;
  }
  function areaPanel(area, slice) {
    const section = el("section", void 0, "area");
    section.dataset.area = area.name;
    if (slice !== void 0) dropTarget(section, { kind: "slice", area: area.name, slice });
    const heading = el("div", void 0, "section-heading"), title = el("div", void 0, "stage-title");
    title.append(el(area.name === "结果" ? "h2" : "h3", area.name));
    heading.append(title);
    if (area.name === "结果" || area.name === "归档") title.append(dateRange(area.name, ranges[area.name]));
    if (area.name === "结果") {
      const tools = controls(), summary = el("span", void 0, "result-summary");
      summary.append(el("small", "投入"), el("strong", duration(area.totals.elapsedMs)));
      const review2 = control("投入回顾", "review", { events: area.review, name: "结果投入" }, "chart", "投入回顾"), add = control("新增根事项", "add-item", { path: area.path }, "plus", "新增根事项");
      add.className = "primary";
      tools.append(summary, review2, add);
      heading.append(tools);
    }
    if (area.name === "待办") title.append(control("新增待办", "record", { tags: area.tags, slice }, "plus"), control("选择或管理模板", "templates", { slice }, "clipboard"), control("新增闭环", "add-loop", { tags: area.tags, slice }, "folder"));
    if (area.name === "运行") title.append(el("span", void 0, "live-dot"), control("快速运行", "record-start", { tags: area.tags, slice }, "play"));
    if (area.name !== "结果") heading.append(el("small", `${area.members.length} 件`, "count"));
    section.append(heading, ...area.direct.map((event) => eventCard(event, area.tags, slice)), ...area.children.map((child) => branch(child, area.name, slice)));
    if (!area.direct.length && !area.children.length) section.append(el("p", area.name === "结果" ? "从一个值得长期投入的事项开始。" : area.name === "运行" ? "暂无运行中的小事" : area.name === "待办" ? "暂无待办小事" : "暂无匹配的归档", "empty"));
    return section;
  }
  function slicePanel(panel) {
    const section = el("section", void 0, "small-page");
    section.dataset.slice = panel.slice ?? "";
    section.setAttribute("aria-label", panel.name);
    const heading = el("div", void 0, "slice-heading"), title = el("h2", panel.name);
    dropTarget(title, { kind: "slice", slice: panel.slice });
    const buttons = controls();
    if (panel.slice !== null) buttons.append(control("修改切片", "rename-slice", { slice: panel.slice }, "pencil"), control("删除切片", "delete-slice", { slice: panel.slice }, "minus"));
    buttons.append(control("新增切片", "add-slice", { slice: panel.slice }, "plus"));
    heading.append(title, buttons);
    section.append(heading);
    if (panel.slice === null && structure2.missingSlices.length) section.append(el("p", `缺失切片：${structure2.missingSlices.join("、")}。相关小事暂显示在这里，新增同名切片即可归位。`, "slice-warning"));
    for (const name of ["运行", "待办", "归档"]) section.append(areaPanel(panel.areas.find((area) => area.name === name), panel.slice));
    return section;
  }
  function render(next = structure2) {
    sliceLayout.disconnect();
    structure2 = next;
    contexts.clear();
    root2.replaceChildren();
    const mobile = presentation2 === "mobile" || presentation2 === "full" && matchMedia("(max-width:650px)").matches;
    root2.dataset.presentation = mobile ? "mobile" : presentation2;
    if (!mobile && presentation2 !== "full") {
      root2.append(shortcutPage(presentation2, structure2, { areaPanel, resultTimers, settings: desktop ? () => shortcutSettings(modal, desktop) : null }));
      return;
    }
    function resultPage() {
      const left = el("div", void 0, "result-page"), toolbar = el("section", void 0, "workspace-controls");
      toolbar.append(el("small", "COMPOUND", "eyebrow"), el("h1", "让每一次投入积累下来"));
      const row = el("div", void 0, "toolbar"), select = el("select");
      select.id = "view-select";
      select.setAttribute("aria-label", "事项视图");
      select.append(new Option("默认视图", ""));
      for (const view of structure2.views) select.append(new Option(view.name, String(view.id)));
      select.value = structure2.currentView === null ? "" : String(structure2.currentView);
      const input = el("input");
      input.id = "search";
      input.placeholder = "搜索事项或小事";
      input.setAttribute("aria-label", "搜索");
      input.value = search;
      row.append(select, control("新增视图", "add-view", {}, "plus"), input);
      toolbar.append(row);
      left.append(toolbar, resultTimers(), areaPanel(structure2.areas.find((area) => area.name === "结果")));
      return left;
    }
    if (mobile) root2.append(mobilePage({ selected: mobileArea, select: (name) => {
      mobileArea = name;
      render();
    }, logout, result: resultPage, timers: resultTimers, area: () => areaPanel(structure2.areas.find((area) => area.name === mobileArea)) }));
    else {
      const right = el("section", void 0, "slice-panels");
      right.setAttribute("aria-label", "小事面板");
      right.append(...structure2.slicePanels.map(slicePanel));
      root2.append(resultPage(), right);
      sliceLayout.observe(right);
      for (const panel of right.children) sliceLayout.observe(panel);
    }
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
    root2.classList.toggle("saving", value);
    document.querySelectorAll("button,input,select,textarea").forEach((node) => {
      node.disabled = value;
    });
  }
  function clearDrop() {
    for (const node of document.querySelectorAll(".drop-inside,.drop-before,.drop-after")) node.classList.remove("drop-inside", "drop-before", "drop-after");
  }
  function modal(title) {
    const dialog = el("dialog"), form = el("form"), heading = el("div", void 0, "dialog-heading");
    dialog.setAttribute("aria-label", title);
    heading.append(el("h2", title));
    heading.append(iconButton({ icon: "close", label: "关闭", onClick: () => dialog.close() }));
    form.append(heading);
    const error = el("p", "", "dialog-error");
    error.setAttribute("role", "alert");
    form.append(error);
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    return { dialog, form, show: () => dialog.showModal() };
  }
  function nameDialog(title, initial, submit) {
    const { dialog, form, show } = modal(title), input = el("input");
    input.value = initial;
    input.required = true;
    input.setAttribute("aria-label", title);
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
  function editor(initial, submit, { steps, editing = false, elapsedMs } = {}) {
    const title = editing ? "修改事实" : steps[0] === "score" ? "选择评分" : elapsedMs !== void 0 ? "结束计时" : "写下一条事实";
    capture(modal(title), { text: initial.text, attributes: initial.meta.filter((tag) => tag.kind === "属性").map((tag) => tag.text).join("\n"), seconds: events2.elapsed({ meta: initial.meta }) }, {
      steps,
      editing,
      createSpeech: createSpeech2,
      context: initial.meta.filter((tag) => tag.kind !== "属性").map((tag) => tag.kind === "闭环" ? events2.loopTag(tag.text).name : tag.text).join(" / "),
      measured: elapsedMs === void 0 ? "" : `累计耗时：${duration(events2.elapsed({ meta: initial.meta }) * 1e3 + elapsedMs)}`
    }, (draft) => {
      let meta = [...initial.meta.filter((tag) => tag.kind !== "属性"), ...draft.attributes.split("\n").filter(Boolean).map((text) => ({ kind: "属性", text }))];
      if (steps.includes("duration")) meta = events2.setAttribute({ meta }, "耗时", `${draft.seconds}s`);
      if (steps.includes("score")) meta = events2.setAttribute({ meta }, "评分", draft.score);
      return submit({ text: draft.text, meta });
    });
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
      let name = record?.events[0].meta[0].text ?? "", texts = record?.events.map((event) => event.user.event) ?? [], folded = false;
      const template = record?.id ?? crypto.randomUUID();
      const label = el("div"), caption = el("span"), count = el("small"), nameInput = el("input");
      nameInput.setAttribute("aria-label", "模板名称");
      nameInput.placeholder = "闭环模板名称";
      nameInput.value = name;
      label.append(caption, nameInput);
      function title() {
        caption.textContent = name || "未命名模板";
        count.textContent = `${texts.length} 件`;
      }
      function rename() {
        caption.hidden = true;
        nameInput.hidden = false;
        nameInput.value = name;
        nameInput.focus();
      }
      function acceptName() {
        name = nameInput.value.trim();
        caption.hidden = false;
        nameInput.hidden = true;
        title();
      }
      nameInput.oninput = () => {
        name = nameInput.value.trim();
        title();
      };
      nameInput.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          acceptName();
        }
      };
      const more = iconButton({ icon: "plus", label: "+ 增加模板事项" }), change = iconButton({ icon: "pencil", label: "重命名模板", onClick: rename }), remove = iconButton({ icon: "minus", label: "删除模板" });
      const group = loopGroup({ key: `template:${template}`, label, count, buttons: [more, change, remove], onToggle: () => {
        folded = !folded;
        group.setCollapsed(folded);
      } });
      const { section, content } = group;
      section.classList.add("template-draft");
      section.dataset.template = template;
      content.classList.add("template-items");
      function rows(editIndex = -1) {
        content.replaceChildren();
        texts.forEach((text, index) => {
          const body = el("div"), textNode = el("span", text || "空正文", "event-body"), input = el("input");
          input.value = text;
          input.setAttribute("aria-label", "模板小事正文");
          input.hidden = index !== editIndex;
          textNode.hidden = !input.hidden;
          const edit = iconButton({ icon: index === editIndex ? "check" : "pencil", label: "修改模板事项" }), drop = iconButton({ icon: "minus", label: "删除模板事项" });
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
          body.append(textNode, input);
          const row = eventRow({ body, buttons: { edit, delete: drop } });
          row.classList.add("draft-row");
          draggable(row, { kind: "template-item", template, index, move: (target, position) => {
            let destination = target + (position === "after" ? 1 : 0);
            if (destination > index) destination--;
            if (destination === index) return;
            texts.splice(destination, 0, texts.splice(index, 1)[0]);
            rows();
            title();
          } }, true);
          row.setAttribute("aria-label", `拖动排序：${text || "空正文"}`);
          content.append(row);
          if (!input.hidden) input.focus();
        });
        if (!texts.length) content.append(el("p", "还没有事项，点击右侧加号添加。", "empty"));
        const save = iconButton({ icon: "save", label: "保存模板", text: "保存模板" });
        save.classList.add("template-save");
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
        acceptName();
        editor({ text: "", meta: [] }, (draft2) => {
          texts.push(draft2.text);
          folded = false;
          group.setCollapsed(false);
          rows();
          title();
          return true;
        }, { steps: ["text"] });
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
      management.append(section);
      nameInput.hidden = true;
      title();
      rows();
      if (!record) rename();
    }
    const manageHead = el("div", void 0, "template-manage-heading"), add = iconButton({ icon: "plus", label: "+ 增加模板", text: "增加模板", onClick: () => draft() });
    manageHead.append(el("h3", "管理模板"), add);
    const scroll = el("div", void 0, "template-scroll");
    scroll.append(picker, manageHead, management);
    form.append(scroll);
    records.forEach(draft);
    form.onsubmit = (event) => event.preventDefault();
    show();
  }
  return { dateRanges: () => ({ ...ranges }), setDateRange: (area, value) => {
    ranges[area] = value;
  }, render, tick, busy, status, nameDialog, confirm, editor, review, templateManager, clearDrop, showDrop: (element2, position) => element2.classList.add(`drop-${position}`), context: (id) => contexts.get(id), onFold: (callback) => {
    requestFold = callback;
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

// frontend/shell/input/drag.js
function bindDrag(root2, workspace2, submit) {
  let source = null;
  function destination(event) {
    const element2 = event.target.closest("[data-drop]");
    if (!source || !element2) return null;
    const target = workspace2.context(element2.dataset.drop);
    if (source.kind === "template-item" && target.kind === "template-item") {
      if (source.template !== target.template || source.index === target.index) return null;
      const bounds2 = element2.getBoundingClientRect();
      return { element: element2, target, position: event.clientY < bounds2.top + bounds2.height / 2 ? "before" : "after" };
    }
    if (target.kind === "slice" || target.kind === "loop" && source.slice !== target.slice) {
      if (!["event", "loop"].includes(source.kind) || source.area === "结果" || source.slice === void 0 || target.slice === void 0 || source.slice === target.slice || !source.ids.length) return null;
      if (target.area && source.area !== target.area) return null;
      return { element: element2, target, position: "inside" };
    }
    if (target.kind === "item") {
      if (source.kind === "item") {
        if (source.area !== "结果") return null;
        if (source.path.every((index, depth) => target.path[depth] === index)) return null;
        const bounds2 = element2.getBoundingClientRect(), offset = event.clientY - bounds2.top, edge = Math.min(9, bounds2.height * 0.25);
        return { element: element2, target, position: offset < edge ? "before" : offset > bounds2.height - edge ? "after" : "inside" };
      }
      if (source.area !== "结果" && source.area !== "归档") return null;
      if (source.kind === "event" && source.area === "结果" && JSON.stringify([...source.items].sort()) === JSON.stringify([...target.items].sort())) return null;
      return { element: element2, target, position: "inside" };
    }
    if (target.kind !== "loop" || source.area !== target.area) return null;
    if (source.kind === "event") return source.loop === target.tag.text ? null : { element: element2, target, position: "inside" };
    if (source.kind !== "loop" || source.tag.text === target.tag.text) return null;
    const bounds = element2.getBoundingClientRect();
    return { element: element2, target, position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" };
  }
  document.addEventListener("dragstart", (event) => {
    const element2 = event.target.closest("[data-drag]");
    const control = event.target.closest("button,input,textarea");
    if (!element2 || control && !control.matches(".branch-name") || root2.classList.contains("saving")) {
      event.preventDefault();
      return;
    }
    source = workspace2.context(element2.dataset.drag);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", source.kind);
  });
  document.addEventListener("dragover", (event) => {
    const landing = destination(event);
    workspace2.clearDrop();
    if (!landing) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    workspace2.showDrop(landing.element, landing.position);
  });
  document.addEventListener("dragleave", (event) => {
    if (!document.contains(event.relatedTarget)) workspace2.clearDrop();
  });
  document.addEventListener("drop", (event) => {
    const found = destination(event);
    if (found) {
      event.preventDefault();
      if (source.kind === "template-item") source.move(found.target.index, found.position);
      else void submit(source, found.target, found.position);
    }
    source = null;
    workspace2.clearDrop();
  });
  document.addEventListener("dragend", () => {
    source = null;
    workspace2.clearDrop();
  });
}

// frontend/shell/input/index.js
function bindInput(root2, commands2, workspace2, refresh2, events2, templates2) {
  let saving = false;
  async function run(action, success = "已保存") {
    if (saving) return false;
    saving = true;
    workspace2.busy(true);
    workspace2.status(success === "已读取" ? "正在读取" : "正在保存");
    try {
      await action();
      await refresh2();
      workspace2.status(success);
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
  const fold = (value) => run(() => commands2.setFold(value.tags, value.isFold, value.order));
  workspace2.onFold(fold);
  async function openTemplates(slice) {
    try {
      workspace2.templateManager(await templates2.read(null), { use: (id) => run(() => commands2.useLoopTemplate(id, slice)), save: (id, name, texts) => run(() => commands2.saveLoopTemplate(id, name, texts)), remove: (id) => run(() => commands2.deleteLoopTemplate(id)), reopen: () => openTemplates(slice) });
    } catch (error) {
      workspace2.status(error.message, true);
    }
  }
  bindDrag(root2, workspace2, (source, target, position) => run(() => {
    if (target.kind === "slice" || target.kind === "loop" && source.slice !== target.slice) return commands2.writeEventTags(source.ids, {}, target.slice);
    if (source.kind === "item") return commands2.moveItem(source.path, target.path, position);
    if (source.kind === "loop" && target.kind === "loop") return commands2.reorderLoops(source.area, target.order, source.tag.text, target.tag.text, position);
    const changes = target.kind === "item" ? { "复利事项": target.items, ...source.area === "归档" ? { "业务区域": ["结果"] } : {} } : { "闭环": [target.tag.text] };
    return commands2.writeEventTags(source.ids, changes);
  }));
  root2.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || saving) return;
    const value = workspace2.context(button.dataset.context), action = button.dataset.action;
    switch (action) {
      case "add-slice":
        workspace2.nameDialog("新增切片", "", (name) => run(() => commands2.createSlice(value.slice, name)));
        break;
      case "rename-slice":
        workspace2.nameDialog("修改切片名称", value.slice, (name) => run(() => commands2.renameSlice(value.slice, name)));
        break;
      case "delete-slice":
        workspace2.confirm(`删除切片「${value.slice}」？所有关联小事将回到“小事”，保留正文、业务状态和闭环。`, () => run(() => commands2.deleteSlice(value.slice)));
        break;
      case "fold":
        void fold(value);
        break;
      case "add-view":
        workspace2.nameDialog("新增事项视图", "", (name) => run(() => commands2.createView(name)));
        break;
      case "add-item":
        workspace2.nameDialog("复利事项名称", "", (name) => run(() => commands2.createItem(value.path, name)));
        break;
      case "add-loop":
        workspace2.nameDialog("闭环名称", "", (name) => {
          if (!value.slice) return run(() => commands2.createLoop(name));
          workspace2.editor({ text: "", meta: value.tags }, (draft) => run(() => commands2.createLoop(name, draft, value.slice)), { steps: ["text"] });
          return true;
        });
        break;
      case "rename":
        workspace2.nameDialog("重命名", value.node.name, (name) => run(() => commands2.renameTag(value.node.tag, name)));
        break;
      case "delete-tag":
        workspace2.confirm(`删除「${value.node.name}」及${value.node.tag.kind === "闭环" ? "当前区域" : "全部区域"}成员？`, () => run(() => commands2.deleteTag(value.node.tag, value.node.path, value.node.tags.find((tag) => tag.kind === "业务区域").text, value.slice)));
        break;
      case "record":
      case "record-start": {
        const start = action === "record-start";
        if (start && value.tags.some((tag) => tag.kind === "业务区域" && tag.text === "结果")) {
          void run(() => commands2.writeEvent(null, { text: "", meta: [...value.tags, { kind: "属性", text: "耗时:0s" }] }, "running"));
        } else workspace2.editor({ text: "", meta: value.tags }, (draft) => run(() => commands2.writeEvent(null, { ...draft, slice: value.slice }, start ? "running" : null)), { steps: start ? ["text"] : value.tags.some((tag) => tag.kind === "业务区域" && tag.text === "结果") ? ["text", "duration", "score"] : value.tags.some((tag) => tag.kind === "闭环" || tag.kind === "业务区域" && tag.text === "待办") ? ["text"] : ["text", "score"] });
        break;
      }
      case "edit":
        workspace2.editor({ text: value.event.user.event, meta: value.event.meta }, (draft) => run(() => commands2.writeEvent(value.event.system.source_id, draft)), { steps: ["text"], editing: true });
        break;
      case "delete":
        workspace2.confirm("删除这条小事？", () => run(() => commands2.writeEvent(value.id, { deleted: true })));
        break;
      case "start":
      case "resume":
        void run(() => commands2.writeTimer(value.id, "running"));
        break;
      case "run":
        void run(() => commands2.run(value.id));
        break;
      case "todo":
        void run(() => commands2.writeEvent(value.id, { meta: events2.replace(value.event.meta, "业务区域", ["待办"]) }));
        break;
      case "pause":
        void run(() => commands2.writeTimer(value.id, "paused"));
        break;
      case "finish":
      case "archive":
        void (async () => {
          let prepared;
          if (await run(async () => {
            prepared = await commands2.writeTimer(value.id, "paused");
          })) {
            workspace2.editor({ text: value.event.user.event, meta: value.event.meta }, (draft) => run(() => commands2.writeEvent(value.id, { ...draft, meta: action === "archive" ? events2.replace(draft.meta, "业务区域", ["归档"]) : draft.meta, elapsedMs: prepared.elapsed_ms }, "reset")), { steps: action === "archive" ? ["score"] : ["text", "score"], elapsedMs: prepared.elapsed_ms });
          }
        })();
        break;
      case "review":
        workspace2.review(value.events, value.name);
        break;
      case "templates":
        void openTemplates(value.slice);
        break;
    }
  });
  root2.addEventListener("change", (event) => {
    if (event.target.id === "view-select") void run(() => commands2.switchView(event.target.value ? Number(event.target.value) : null));
    if (event.target.dataset.dateArea) {
      const { dateArea } = event.target.dataset, value = event.target.value;
      void run(() => workspace2.setDateRange(dateArea, value), "已读取");
    }
  });
  root2.addEventListener("input", (event) => {
    if (event.target.id === "search") workspace2.search(event.target.value);
  });
}

// frontend/access/index.js
function createAccess() {
  const base = new URL(".", location.href);
  let csrf = null, publicAccess = false;
  async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (csrf && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
    return fetch(new URL(path.replace(/^\//, ""), base), { ...options, headers });
  }
  function openSocket(path, { signal } = {}) {
    const url = new URL(path.replace(/^\//, ""), base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => finish(new Error("语音连接超时")), 1e4);
      const abort = () => finish(new Error("语音连接已取消"));
      function finish(error) {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        if (error) {
          socket.close();
          reject(error);
        } else resolve(socket);
      }
      socket.onopen = () => socket.send(JSON.stringify({ type: "authorize", csrf }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "authorized") finish();
          else finish(new Error(message.message || "语音会话校验失败"));
        } catch {
          finish(new Error("语音会话返回无效消息"));
        }
      };
      socket.onerror = socket.onclose = () => finish(new Error("语音连接失败，请检查登录和网络"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }
  async function enter(root2) {
    const response = await request("/access/session");
    const session = await response.json();
    if (!response.ok) throw new Error(session.error || "无法读取登录状态");
    csrf = session.csrf ?? null;
    publicAccess = !session.local;
    if (session.authenticated) return;
    await new Promise((resolve) => {
      const form = document.createElement("form");
      form.className = "login-card";
      const title = document.createElement("h1");
      title.textContent = "Compound";
      const hint = document.createElement("p");
      hint.textContent = `登录 ${session.environment}`;
      const input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "current-password";
      input.required = true;
      input.setAttribute("aria-label", "登录密码");
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "登录";
      button.className = "primary";
      const error = document.createElement("p");
      error.setAttribute("role", "alert");
      error.className = "dialog-error";
      let completed = false;
      async function login(password) {
        if (completed) return true;
        button.disabled = true;
        error.textContent = "";
        try {
          const response2 = await request("/access/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
          const result = await response2.json();
          if (!response2.ok) throw new Error(result.error);
          completed = true;
          csrf = result.csrf;
          input.value = "";
          delete root2.dataset.access;
          resolve();
          return true;
        } catch (failure) {
          error.textContent = failure.message;
          throw failure;
        } finally {
          button.disabled = false;
        }
      }
      form.append(title, hint, input, error, button);
      root2.replaceChildren(form);
      root2.dataset.access = "login";
      input.focus();
      window.compoundNativeLogin = login;
      window.webkit?.messageHandlers?.compoundAccess?.postMessage({ type: "loginRequired", environment: session.environment });
      form.onsubmit = (event) => {
        event.preventDefault();
        login(input.value).catch(() => {
        });
      };
    });
    delete window.compoundNativeLogin;
  }
  async function logout() {
    const response = await request("/access/logout", { method: "POST" });
    if (!response.ok) throw new Error("退出失败");
    location.reload();
  }
  async function provisionWatch() {
    if (!publicAccess || !window.webkit?.messageHandlers?.compoundAccess) return;
    const response = await request("/access/watch-token", { method: "POST" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "无法授权 Apple Watch");
    window.webkit.messageHandlers.compoundAccess.postMessage({ type: "watchCredential", ...value, baseURL: base.href });
  }
  return { request, openSocket, enter, logout, provisionWatch, get public() {
    return publicAccess;
  } };
}

// frontend/shell/watch_snapshot/index.js
function item(event, timer2, keyOf2) {
  const key = keyOf2(event.system.source_id), snapshot = timer2.snapshot(key);
  return { id: key, title: event.user.event || "尚未填写正文", elapsedMs: timer2.elapsed(key), timerState: snapshot?.state ?? "idle" };
}
function areaSnapshot(area, timer2, keyOf2) {
  const direct = [], loops = [];
  function visit(node) {
    if (node.tag.kind === "闭环") {
      loops.push({ id: String(node.loop?.id ?? node.tag.text), name: node.name || "未命名闭环", items: node.members.map((event) => item(event, timer2, keyOf2)) });
      return;
    }
    direct.push(...node.direct.map((event) => item(event, timer2, keyOf2)));
    node.children.forEach(visit);
  }
  visit(area);
  return { direct, loops };
}
function createWatchSnapshot(structure2, timer2, keyOf2) {
  const resultTimers = structure2.resultEvents.flatMap(({ event, label }) => {
    const value = item(event, timer2, keyOf2);
    if (value.timerState === "idle" || value.timerState === "paused" && !value.elapsedMs) return [];
    return [{ ...value, title: event.user.event || label || "未命名计时" }];
  });
  const area = (name) => structure2.areas.find((value) => value.name === name);
  const environment = globalThis.location?.pathname.includes("/prod/") ? "PROD" : "DEV";
  const todoPages = structure2.slicePanels.map((panel) => ({
    name: panel.slice ?? "默认待办",
    slice: panel.slice,
    area: areaSnapshot(panel.areas.find((value) => value.name === "待办"), timer2, keyOf2)
  }));
  return { environment, generatedAt: Date.now() / 1e3, resultTimers, running: areaSnapshot(area("运行"), timer2, keyOf2), todo: areaSnapshot(area("待办"), timer2, keyOf2), todoPages };
}
function postWatchSnapshot(snapshot) {
  window.webkit?.messageHandlers?.compoundWatchSnapshot?.postMessage(snapshot);
}

// frontend/theme/settings.js
var element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== void 0) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function appearanceSettings(read, update) {
  const dialog = element("dialog", void 0, "theme-settings"), form = element("form");
  dialog.setAttribute("aria-label", "外观设置");
  const heading = element("div", void 0, "dialog-heading"), close = element("button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭外观设置");
  close.onclick = () => dialog.close();
  heading.append(element("h2", "外观设置"), close);
  const theme = element("select");
  theme.setAttribute("aria-label", "主题");
  theme.append(new Option("默认主题", "default"), new Option("异闻录 · 高卷杏", "persona"));
  const motion = element("input");
  motion.type = "checkbox";
  motion.setAttribute("aria-label", "点击动效");
  const sound = element("input");
  sound.type = "checkbox";
  sound.setAttribute("aria-label", "点击音效");
  const volume = element("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.setAttribute("aria-label", "音量");
  const note = element("p", "", "theme-note");
  note.setAttribute("role", "status");
  const error = element("p", "", "dialog-error");
  error.setAttribute("role", "alert");
  function sync() {
    const preferences = read();
    theme.value = preferences.theme;
    motion.checked = preferences.motion;
    sound.checked = preferences.sound;
    volume.value = String(preferences.volume);
    note.textContent = preferences.error || "切换立即生效，仅保存本机外观偏好。系统减少动态效果设置优先。";
  }
  function change(value) {
    update(value);
    sync();
  }
  for (const [label, control] of [["主题", theme], ["点击动效", motion], ["点击音效", sound], ["音量", volume]]) {
    const row = element("label", void 0, "theme-setting");
    row.append(element("span", label), control);
    form.append(row);
  }
  theme.onchange = () => change({ theme: theme.value });
  motion.onchange = () => change({ motion: motion.checked });
  sound.onchange = () => change({ sound: sound.checked });
  volume.oninput = () => change({ volume: Number(volume.value) });
  form.prepend(heading, error);
  form.append(note);
  form.onsubmit = (event) => event.preventDefault();
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  sync();
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  return { dialog, sync };
}

// frontend/theme/feedback.js
function bindFeedback(read) {
  let audio;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function click(event) {
    const target = event.target.closest?.("button,[role=button],summary");
    if (!event.isTrusted || !target || target.matches(":disabled") || target.closest(".theme-settings")) return;
    const preferences = read();
    if (preferences.theme !== "persona") return;
    if (preferences.motion && !reduced.matches) {
      const box = target.getBoundingClientRect(), impact = document.createElement("div");
      impact.className = "theme-impact";
      impact.setAttribute("aria-hidden", "true");
      const dialog = target.closest("dialog"), origin = dialog?.getBoundingClientRect();
      if (dialog) impact.style.position = "absolute";
      impact.style.left = `${(event.detail ? event.clientX : box.x + box.width / 2) - (origin?.x ?? 0) + (dialog?.scrollLeft ?? 0) - (dialog?.clientLeft ?? 0) - 22}px`;
      impact.style.top = `${(event.detail ? event.clientY : box.y + box.height / 2) - (origin?.y ?? 0) + (dialog?.scrollTop ?? 0) - (dialog?.clientTop ?? 0) - 22}px`;
      const host = dialog || document.body;
      host.append(impact);
      const animation = impact.animate([{ transform: "scale(.35) rotate(-18deg)", opacity: 1 }, { transform: "scale(1.4) rotate(12deg)", opacity: 0 }], { duration: 230, easing: "cubic-bezier(.2,.8,.2,1)" });
      void animation.finished.catch(() => {
      }).finally(() => impact.remove());
    }
    if (preferences.sound && preferences.volume > 0) {
      try {
        audio ??= new AudioContext();
        void audio.resume().catch(() => {
        });
        const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(760, now);
        oscillator.frequency.exponentialRampToValueAtTime(180, now + 0.055);
        gain.gain.setValueAtTime(1e-4, now);
        gain.gain.exponentialRampToValueAtTime(preferences.volume / 100 * 0.12, now + 4e-3);
        gain.gain.exponentialRampToValueAtTime(1e-4, now + 0.075);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.08);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      } catch (error) {
        console.error("点击音效不可用", error);
      }
    }
  }
  document.addEventListener("click", click, true);
  return () => {
    document.removeEventListener("click", click, true);
    if (audio) void audio.close();
  };
}

// frontend/theme/paper/index.js
var cache = /* @__PURE__ */ new Map();
function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0), 16777619);
  return result >>> 0;
}
function hue(value) {
  let result = hash(value);
  result = Math.imul(result ^ result >>> 16, 2146121005);
  result = Math.imul(result ^ result >>> 15, 2221713035);
  return ((result ^ result >>> 16) >>> 0) % 360;
}
function paperMask(width, height, key, tear = 3) {
  const w = Math.max(16, Math.ceil(width / 4) * 4), h = Math.max(12, Math.ceil(height / 2) * 2), variant = hash(key) % 48;
  const identity = `${w}:${h}:${variant}:${tear}`;
  if (cache.has(identity)) return cache.get(identity);
  let state = variant + 1;
  const random = () => {
    state = Math.imul(state, 1664525) + 1013904223 | 0;
    return (state >>> 0) / 4294967296;
  };
  if (tear === 3) {
    const points2 = [], edge = Math.min(7, h * 0.22), side = Math.min(13, w * 0.15);
    const left = side * (0.25 + random() * 0.6), right = side * (0.25 + random() * 0.6);
    const upper = random() * edge * 0.65, lower = random() * edge * 0.65;
    for (let x = left; x < w - right; x += 4 + random() * 7) {
      const slope = upper * x / w, bite = random() < 0.22 ? edge * 0.75 : random() * edge * 0.42;
      points2.push(`${x.toFixed(2)},${(slope + bite).toFixed(2)}`);
    }
    points2.push(`${w - right},${edge * 0.35}`);
    for (let y = edge * 0.35; y < h - edge * 0.35; y += 3 + random() * 4) points2.push(`${(w - right * (y / h) - random() * side * 0.45).toFixed(2)},${y.toFixed(2)}`);
    points2.push(`${w - right * 0.7},${h - lower}`);
    for (let x = w - right * 0.7; x > left; x -= 4 + random() * 7) {
      const slope = lower * (1 - x / w), bite = random() < 0.22 ? edge * 0.8 : random() * edge * 0.4;
      points2.push(`${x.toFixed(2)},${(h - slope - bite).toFixed(2)}`);
    }
    points2.push(`${left * 0.3},${h - edge * 0.35}`);
    for (let y = h - edge * 0.35; y > edge * 0.35; y -= 3 + random() * 4) points2.push(`${(left * (1 - y / h) + random() * side * 0.5).toFixed(2)},${y.toFixed(2)}`);
    const scraps = [];
    for (let x = 7; x < w - 7; x += 9 + random() * 14) {
      const size = 3 + random() * 8, top = random() * 8, bottom = h - random() * 8;
      scraps.push(`<path d="M${x} ${top}l${size} ${random() * 5}l${-size * 0.35} ${size * 0.7}l${-size} ${-size * 0.25}z M${x} ${bottom}l${size} ${-random() * 5}l${-size * 0.55} ${-size * 0.7}l${-size * 0.7} ${size * 0.25}z" fill="white" opacity="1"/>`);
    }
    const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><polygon points="${points2.join(" ")}" fill="white"/>${scraps.join("")}</svg>`;
    const result2 = `url("data:image/svg+xml,${encodeURIComponent(svg2)}")`;
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(identity, result2);
    return result2;
  }
  const points = [], step = 7;
  for (let x = 0; x <= w; x += step) points.push(`${x},${(random() * tear).toFixed(2)}`);
  points.push(`${w},1`);
  for (let y = 3; y < h; y += step) points.push(`${(w - random() * tear).toFixed(2)},${y}`);
  points.push(`${w},${h - 1}`);
  for (let x = w; x >= 0; x -= step) points.push(`${x},${(h - random() * tear).toFixed(2)}`);
  points.push(`0,${h - 1}`);
  for (let y = h - 3; y > 0; y -= step) points.push(`${(random() * tear).toFixed(2)},${y}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><polygon points="${points.join(" ")}" fill="white"/></svg>`;
  const result = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(identity, result);
  return result;
}
function createPaper(root2) {
  let enabled = false, frame = 0;
  const watched = /* @__PURE__ */ new Set(), layers = /* @__PURE__ */ new Map(), patches = /* @__PURE__ */ new Map(), hues = /* @__PURE__ */ new Set();
  const selector = "[data-paper],button,.loop-name,.count,dialog,.login-card";
  function layer(host) {
    if (layers.has(host)) return layers.get(host);
    const board = document.createElement("div");
    board.className = "theme-paper-layer";
    board.setAttribute("aria-hidden", "true");
    host.append(board);
    layers.set(host, board);
    return board;
  }
  function paint(node) {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    const visible = node.isConnected && box.width && box.height && box.bottom > -40 && box.top < innerHeight + 40 && style.visibility !== "hidden" && style.opacity !== "0";
    if (node.matches("dialog,.login-card")) {
      if (visible) {
        node.style.setProperty("--surface-mask", paperMask(box.width, box.height, node.getAttribute("aria-label") || node.className, 8));
        node.dataset.surfaceReady = "";
      }
      return;
    }
    const host = node.closest("dialog,.login-card") || root2;
    let patch = patches.get(node);
    if (!visible) {
      if (patch) patch.hidden = true;
      return;
    }
    const board = layer(host);
    if (!patch) {
      patch = document.createElement("span");
      patch.className = "theme-paper-patch";
      patches.set(node, patch);
    }
    if (patch.parentElement !== board) board.append(patch);
    patch.hidden = false;
    const origin = host === root2 ? { x: 0, y: 0 } : host.getBoundingClientRect();
    const identity = node.closest("[data-visual-key]")?.dataset.visualKey || node.dataset.paperKey || node.getAttribute("aria-label") || node.textContent;
    const mask = paperMask(box.width + 44, box.height + 28, `${identity}:${node.dataset.paper || "button"}`);
    patch.style.left = `${box.x - origin.x + (host === root2 ? 0 : host.scrollLeft - host.clientLeft) - 22}px`;
    patch.style.top = `${box.y - origin.y + (host === root2 ? 0 : host.scrollTop - host.clientTop) - 14}px`;
    patch.style.width = `${box.width + 44}px`;
    patch.style.height = `${box.height + 28}px`;
    patch.style.maskImage = mask;
    const fill = style.getPropertyValue("--paper-fill").trim() || style.getPropertyValue("--paper").trim();
    patch.style.background = fill;
    patch.style.zIndex = style.getPropertyValue("--paper-order").trim() || (fill.includes("#df1329") || fill.includes("#171317") ? "1" : "0");
    node.dataset.paperReady = "";
  }
  function collect(element2) {
    if (element2.closest(".theme-paper-layer,.theme-impact")) return;
    for (const node of [...element2.matches(selector) ? [element2] : [], ...element2.querySelectorAll(selector)]) {
      if (watched.has(node)) continue;
      if (!node.matches("button,dialog,.login-card") && node.parentElement.closest("[data-paper]")) continue;
      const loop = node.closest(".loop[data-visual-key]");
      if (loop && !hues.has(loop)) {
        loop.style.setProperty("--paper-hue", hue(loop.dataset.visualKey));
        hues.add(loop);
      }
      watched.add(node);
      resize.observe(node);
    }
  }
  function flush() {
    frame = 0;
    for (const node of watched) {
      if (!node.isConnected) {
        resize.unobserve(node);
        watched.delete(node);
        patches.get(node)?.remove();
        patches.delete(node);
      } else paint(node);
    }
    for (const [host, board] of layers) if (host !== root2 && !host.isConnected) {
      board.remove();
      layers.delete(host);
    }
    for (const loop of hues) if (!loop.isConnected) hues.delete(loop);
  }
  function schedule() {
    if (enabled && !frame) frame = requestAnimationFrame(flush);
  }
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver((records) => {
    let changed = false;
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest(".theme-paper-layer,.theme-impact")) continue;
      for (const node of record.addedNodes) if (node instanceof Element && !node.matches(".theme-paper-layer,.theme-paper-patch,.theme-impact")) {
        collect(node);
        changed = true;
      }
      if ([...record.removedNodes].some((node) => node instanceof Element && !node.matches(".theme-paper-layer,.theme-paper-patch,.theme-impact"))) changed = true;
    }
    if (changed) schedule();
  });
  function enable(value) {
    if (enabled === value) return;
    enabled = value;
    if (enabled) {
      collect(root2);
      flush();
      mutations.observe(root2, { childList: true, subtree: true });
      window.addEventListener("scroll", schedule, true);
      root2.addEventListener("pointerover", schedule);
      root2.addEventListener("pointerout", schedule);
      root2.addEventListener("focusin", schedule);
      root2.addEventListener("focusout", schedule);
      window.addEventListener("resize", schedule);
    } else {
      mutations.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("scroll", schedule, true);
      root2.removeEventListener("pointerover", schedule);
      root2.removeEventListener("pointerout", schedule);
      root2.removeEventListener("focusin", schedule);
      root2.removeEventListener("focusout", schedule);
      window.removeEventListener("resize", schedule);
      for (const node of watched) {
        delete node.dataset.paperReady;
        delete node.dataset.surfaceReady;
        node.style.removeProperty("--surface-mask");
      }
      for (const board of layers.values()) board.remove();
      for (const loop of hues) loop.style.removeProperty("--paper-hue");
      watched.clear();
      patches.clear();
      layers.clear();
      hues.clear();
    }
  }
  return { enable, dispose: () => enable(false) };
}

// frontend/theme/index.js
var storageKey = "compound:appearance";
var defaults = { theme: "default", motion: true, sound: false, volume: 35 };
function validated(value) {
  return { theme: value?.theme === "persona" ? "persona" : "default", motion: typeof value?.motion === "boolean" ? value.motion : true, sound: typeof value?.sound === "boolean" ? value.sound : false, volume: Number.isFinite(value?.volume) ? Math.max(0, Math.min(100, value.volume)) : 35 };
}
function createTheme() {
  let preferences = { ...defaults }, error = "", panel;
  try {
    preferences = validated(JSON.parse(localStorage.getItem(storageKey)));
  } catch {
    error = "本机外观偏好无法读取，本次使用默认主题。";
  }
  const paper = createPaper(document.body);
  const read = () => ({ ...preferences, error });
  function apply() {
    document.documentElement.dataset.theme = preferences.theme;
    document.querySelector("meta[name=theme-color]").content = preferences.theme === "persona" ? "#de1529" : "#432065";
    paper.enable(preferences.theme === "persona");
    panel?.sync();
  }
  function update(value) {
    preferences = validated({ ...preferences, ...value });
    error = "";
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      error = "本机外观偏好无法保存；当前页面仍可使用，重新打开后不会保留。";
    }
    apply();
  }
  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "theme-entry";
  entry.textContent = "外观";
  entry.setAttribute("aria-label", "外观设置");
  entry.onclick = () => {
    if (panel?.dialog.open) {
      panel.dialog.focus();
      return;
    }
    panel = appearanceSettings(read, update);
  };
  document.body.append(entry);
  const releaseFeedback = bindFeedback(read);
  function storage(event) {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      preferences = validated(JSON.parse(event.newValue));
      error = "";
      apply();
    } catch {
      error = "其他窗口的外观偏好无法读取。";
      panel?.sync();
    }
  }
  window.addEventListener("storage", storage);
  apply();
  return { read, update, dispose() {
    paper.dispose();
    releaseFeedback();
    window.removeEventListener("storage", storage);
    panel?.dialog.close();
    entry.remove();
  } };
}

// frontend/main.js
createTheme();
var access = createAccess();
await access.enter(document.querySelector("#workspace"));
access.provisionWatch().catch(() => {
});
async function call(path, value) {
  const response = await access.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
var keyOf = (id) => String(id);
var events = createEvents(call, JSON.parse(document.querySelector("#protocol").textContent));
var forest = createForest(call);
var templates = createTemplates(call);
var timer = createTimer(call);
var slices = createSlices(call);
var projection = createProjection(forest, events, slices);
var commands = createCommands(events, forest, templates, timer, keyOf, slices);
var requested = new URLSearchParams(location.search).get("presentation");
var presentation = ["running", "todo", "mobile"].includes(requested) ? requested : "full";
var speech = (callbacks) => createSpeech({ ...callbacks, request: access.request, openSocket: access.openSocket });
var root = document.querySelector("#workspace");
var workspace = createWorkspace(root, timer, keyOf, events, speech, { presentation, desktop: window.compoundDesktop ?? null, logout: access.public ? () => access.logout().catch((error) => workspace.status(error.message, true)) : null });
var structure;
var reading = Promise.resolve();
var backgroundPending = false;
var pendingRender = false;
function publishWatch() {
  if (structure) postWatchSnapshot(createWatchSnapshot(structure, timer, keyOf));
}
async function load(background) {
  if (background && root.classList.contains("saving")) return;
  const next = await projection.read(workspace.dateRanges());
  const keys = next.events.map((event) => keyOf(event.system.source_id));
  const previous = keys.map((key) => timer.snapshot(key));
  const structureChanged = JSON.stringify(next) !== JSON.stringify(structure);
  await timer.read(keys);
  if (background && root.classList.contains("saving")) return;
  const timerChanged = keys.some((key, index) => {
    const before = previous[index], after = timer.snapshot(key);
    return before?.state !== after?.state || after?.state === "paused" && before?.elapsed_ms !== after.elapsed_ms;
  });
  structure = next;
  const changed = structureChanged || timerChanged;
  const editing = document.querySelector("dialog[open]") || document.activeElement?.matches("input,textarea") || root.querySelector(".drop-inside,.drop-before,.drop-after");
  if (!background || (changed || pendingRender) && !editing) {
    workspace.render(structure);
    pendingRender = false;
  } else if (changed) pendingRender = true;
  if (!background || changed) publishWatch();
}
function refresh() {
  const next = reading.catch(() => {
  }).then(() => load(false));
  reading = next;
  return next;
}
function poll() {
  if (backgroundPending || root.classList.contains("saving")) return;
  backgroundPending = true;
  const next = reading.catch(() => {
  }).then(() => load(true));
  reading = next;
  void next.catch((error) => workspace.status(error.message, true)).finally(() => {
    backgroundPending = false;
  });
}
var watchActions = {
  run: (id) => commands.run(id),
  resume: (id) => commands.writeTimer(id, "running"),
  pause: (id) => commands.writeTimer(id, "paused"),
  archive: (id) => commands.archive(id)
};
window.compoundWatch = { perform: async (action, rawID) => {
  const id = Number(rawID), execute = watchActions[action];
  if (!execute || !Number.isSafeInteger(id)) throw new Error("不支持的手表操作");
  await execute(id);
  await refresh();
  return createWatchSnapshot(structure, timer, keyOf);
} };
bindInput(root, commands, workspace, refresh, events, templates);
setInterval(workspace.tick, 250);
setInterval(() => {
  publishWatch();
  poll();
}, 1e3);
try {
  await refresh();
  workspace.status("已读取");
} catch (error) {
  workspace.status(error.message, true);
}
function resume() {
  if (!document.hidden && !document.querySelector("dialog[open]") && !root.classList.contains("saving")) refresh().catch((error) => workspace.status(error.message, true));
}
window.addEventListener("focus", resume);
document.addEventListener("visibilitychange", resume);
matchMedia("(max-width:650px)").addEventListener("change", () => {
  if (!document.querySelector("dialog[open]")) workspace.render();
});
