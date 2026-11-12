/**
 * Client 半：设置页「完整性守护」。
 *
 * 所有读写都走宿主已有的 `POST /integrity-guard/bridge`，客户端不碰文件系统。
 * 页面只做三件事：改守护范围、看最近一次扫描结果、手动触发一次扫描。
 */
window.__ModuleLoader__.load({
  id: '@local/integrity-guard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'integrity-guard';
    const BRIDGE = '/integrity-guard/bridge';
    const HOME_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'];
    const DEPTHS = [0, 1, 2, 3, 4];

    const ZH = {
      'settings.title': '完整性守护',
      'page.intro':
        'DSH 的沙箱会把会话工作区标成 Low 完整性，标签会继承给整个目录树。这里决定哪些目录被检查、被擦回 Medium，以及哪些目录允许保留 Low。',
      'group.guard': '守护',
      'enabled': '启用守护',
      'enabledHint': '关闭后不再自动扫描，手动扫描也会被跳过。',
      'depth': '扫描深度',
      'depthHint': '从每个根往下展开几层，0 表示只查根本身。',
      'group.folders': '用户文件夹',
      'foldersHint': '从用户目录下展开这些子目录，勾选即纳入扫描。',
      'group.extra': '额外扫描的目录',
      'extraHint': '除用户文件夹和已登记工作区之外，还想检查的根目录。',
      'group.allowed': '允许保留 Low 的目录',
      'allowedHint': '默认工作区应该留在这里；把目录加进来就表示不要动它。',
      'group.status': '状态',
      'activeSessions': '活动会话',
      'lastScan': '最近扫描',
      'never': '尚未扫描',
      'scanNow': '立即扫描',
      'scanning': '扫描中…',
      'saved': '已保存',
      'loadFailed': '读取配置失败',
      'saveFailed': '保存失败',
      'scanFailed': '扫描失败',
      'add': '添加',
      'remove': '移除',
      'pathPlaceholder': '例如 D:\\Projects',
      'group.log': '最近记录',
      'noLogs': '还没有记录。',
      'checked': '检查 {n} 个目录',
      'fixed': '修复 {n} 个',
      'errors': '失败 {n} 个',
      'adminHint': '改回 Medium 需要管理员权限。普通权限下会被系统拒绝访问，失败原因已逐条列在下面。',
      'took': '用时 {ms} ms',
      'kind.scan': '扫描',
      'kind.fixed': '修复',
      'kind.error': '错误',
    };

    const EN = {
      'settings.title': 'Integrity Guard',
      'page.intro':
        'The DSH sandbox marks session workspaces as Low integrity, and the label is inherited by the whole tree. This page decides which folders are checked and reset to Medium, and which folders are allowed to keep Low.',
      'group.guard': 'Guard',
      'enabled': 'Enable guard',
      'enabledHint': 'When off, automatic scans stop and manual scans are skipped.',
      'depth': 'Scan depth',
      'depthHint': 'How many levels to expand under each root; 0 checks the root only.',
      'group.folders': 'Home folders',
      'foldersHint': 'Subfolders of your home directory that are included in scans.',
      'group.extra': 'Extra roots',
      'extraHint': 'Additional roots to check besides home folders and registered workspaces.',
      'group.allowed': 'Allowed Low roots',
      'allowedHint': 'The default workspace belongs here. Roots listed here are never touched.',
      'group.status': 'Status',
      'activeSessions': 'Active sessions',
      'lastScan': 'Last scan',
      'never': 'not scanned yet',
      'scanNow': 'Scan now',
      'scanning': 'Scanning…',
      'saved': 'Saved',
      'loadFailed': 'Failed to load configuration',
      'saveFailed': 'Save failed',
      'scanFailed': 'Scan failed',
      'add': 'Add',
      'remove': 'Remove',
      'pathPlaceholder': 'e.g. D:\\Projects',
      'group.log': 'Recent entries',
      'noLogs': 'Nothing recorded yet.',
      'checked': 'checked {n} folders',
      'fixed': 'fixed {n}',
      'errors': 'failed {n}',
      'adminHint': 'Resetting to Medium needs administrator rights. A normal process is denied access; each failure reason is listed below.',
      'took': 'took {ms} ms',
      'kind.scan': 'scan',
      'kind.fixed': 'fixed',
      'kind.error': 'error',
    };

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0 32px' },
      intro: { margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', maxWidth: '66ch' },
      group: {
        display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12,
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
      },
      groupHead: { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      rowLabel: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      hint: { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      toggle: {
        width: 38, height: 22, borderRadius: 999, padding: 2, cursor: 'pointer', border: 'none',
        background: 'var(--dsw-alias-border-l1)', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'flex-start', transition: 'background .16s',
      },
      toggleOn: { background: 'var(--dsw-alias-brand-primary, #4fb98a)', justifyContent: 'flex-end' },
      knob: { width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' },
      seg: {
        display: 'inline-flex', padding: 2, borderRadius: 9, background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      segBtn: {
        font: 'inherit', fontSize: 12.5, lineHeight: 1, padding: '7px 12px', borderRadius: 7, cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-secondary)',
      },
      segOn: {
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600,
        boxShadow: '0 1px 2px rgba(0,0,0,.12)',
      },
      chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
      chip: {
        font: 'inherit', fontSize: 12, lineHeight: 1, padding: '6px 10px', borderRadius: 999, cursor: 'pointer',
        background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      chipOn: {
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
        borderColor: 'var(--dsw-alias-brand-primary, #4fb98a)',
      },
      pathList: { display: 'flex', flexDirection: 'column', gap: 6 },
      pathRow: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 10px', borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      pathText: {
        flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12,
        color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
      removeBtn: {
        font: 'inherit', fontSize: 12, lineHeight: 1, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary)',
      },
      addRow: { display: 'flex', gap: 8, alignItems: 'center' },
      input: {
        flex: 1, minWidth: 0, font: 'inherit', fontSize: 12.5, padding: '8px 10px', borderRadius: 8,
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      action: {
        font: 'inherit', fontSize: 13, lineHeight: 1, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
        background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4fb98a))', border: 'none', color: 'var(--dsw-alias-label-primary-foreground, #10241c)', fontWeight: 600,
      },
      actionOff: { opacity: 0.55, cursor: 'default' },
      stat: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
      note: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #c4553f)' },
      logs: { display: 'flex', flexDirection: 'column', gap: 4 },
      logRow: {
        display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
      },
      logTime: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 },
      logKind: { flexShrink: 0, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      logPath: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      logBody: { minWidth: 0, display: 'flex', flexDirection: 'column' },
      logReason: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary, #c4553f)' },
    };

    async function call(body) {
      const res = await fetch(BRIDGE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok || !payload || payload.ok === false) {
        throw new Error((payload && (payload.error || payload.detail)) || `HTTP ${res.status}`);
      }
      return payload;
    }

    function formatTime(ts) {
      if (!ts) return '';
      try {
        return new Date(ts).toLocaleTimeString();
      } catch {
        return '';
      }
    }

    function fill(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (whole, key) =>
        values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole);
    }

    function Toggle({ checked, onChange, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: label,
        style: { ...S.toggle, ...(checked ? S.toggleOn : null) },
        onClick: () => onChange(!checked),
      }, h('span', { style: S.knob }));
    }

    function Seg({ values, value, onChange, render }) {
      return h('div', { style: S.seg }, values.map((item) =>
        h('button', {
          key: String(item),
          type: 'button',
          'aria-pressed': item === value ? 'true' : 'false',
          style: { ...S.segBtn, ...(item === value ? S.segOn : null) },
          onClick: () => onChange(item),
        }, render ? render(item) : String(item))));
    }

    function Group({ title, children }) {
      return h('div', { style: S.group }, [
        h('h3', { key: 'head', style: S.groupHead }, title),
        ...children,
      ]);
    }

    function PathList({ paths, onRemove, removeLabel }) {
      if (!paths.length) return null;
      return h('div', { style: S.pathList }, paths.map((item) =>
        h('div', { key: item, style: S.pathRow }, [
          h('span', { key: 'p', style: S.pathText, title: item }, item),
          h('button', {
            key: 'x',
            type: 'button',
            style: S.removeBtn,
            'aria-label': removeLabel,
            title: removeLabel,
            onClick: () => onRemove(item),
          }, '\u00d7'),
        ])));
    }

    function GuardPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => String(key);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [extraDraft, setExtraDraft] = React.useState('');
      const [allowedDraft, setAllowedDraft] = React.useState('');

      const load = React.useCallback(async () => {
        try {
          setData(await call({ action: 'get' }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      async function patch(next) {
        try {
          setBusy('save');
          setData(await call({ action: 'set', patch: next }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy('');
        }
      }

      async function scan() {
        try {
          setBusy('scan');
          setData(await call({ action: 'scan' }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy('');
        }
      }

      function addPath(kind, draft, reset) {
        const value = draft.trim();
        if (!value) return;
        const state = (data && data.state) || {};
        const list = Array.isArray(state[kind]) ? state[kind] : [];
        if (list.some((item) => item.toLowerCase() === value.toLowerCase())) {
          reset('');
          return;
        }
        reset('');
        patch({ [kind]: [...list, value] });
      }

      if (!data) {
        return h('div', { style: S.root }, [
          h('p', { key: 'intro', style: S.intro }, t('page.intro')),
          error ? h('p', { key: 'err', style: S.note }, `${t('loadFailed')}: ${error}`) : null,
        ]);
      }

      const state = data.state || {};
      const homeFolders = Array.isArray(state.homeFolders) ? state.homeFolders : [];
      const extraRoots = Array.isArray(state.extraRoots) ? state.extraRoots : [];
      const allowedRoots = Array.isArray(state.allowedRoots) ? state.allowedRoots : [];
      const last = data.lastScan;
      const logs = Array.isArray(data.log) ? data.log.slice(-6).reverse() : [];
      const busyText = busy === 'scan' ? t('scanning') : t('scanNow');

      const lastText = last
        ? [
            fill(t('checked'), { n: last.checked }),
            fill(t('fixed'), { n: last.fixed }),
            fill(t('errors'), { n: last.errors }),
            fill(t('took'), { ms: last.tookMs }),
          ].join(' \u00b7 ')
        : t('never');

      return h('div', { style: S.root }, [
        h('p', { key: 'intro', style: S.intro }, t('page.intro')),

        error ? h('p', { key: 'err', style: S.note }, error) : null,

        h(Group, { key: 'guard', title: t('group.guard') }, [
          h('div', { key: 'enabled', style: S.row }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'a', style: S.rowLabel }, t('enabled')),
              h('p', { key: 'b', style: S.hint }, t('enabledHint')),
            ]),
            h(Toggle, {
              key: 't',
              checked: state.enabled !== false,
              label: t('enabled'),
              onChange: (value) => patch({ enabled: value }),
            }),
          ]),
          h('div', { key: 'depth', style: S.row }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'a', style: S.rowLabel }, t('depth')),
              h('p', { key: 'b', style: S.hint }, t('depthHint')),
            ]),
            h(Seg, {
              key: 's',
              values: DEPTHS,
              value: state.depth,
              onChange: (value) => patch({ depth: value }),
            }),
          ]),
        ]),

        h(Group, { key: 'folders', title: t('group.folders') }, [
          h('p', { key: 'hint', style: S.hint }, t('foldersHint')),
          h('div', { key: 'chips', style: S.chips }, HOME_FOLDERS.map((name) => {
            const on = homeFolders.includes(name);
            return h('button', {
              key: name,
              type: 'button',
              'aria-pressed': on ? 'true' : 'false',
              style: { ...S.chip, ...(on ? S.chipOn : null) },
              onClick: () => patch({
                homeFolders: on
                  ? homeFolders.filter((item) => item !== name)
                  : [...homeFolders, name],
              }),
            }, name);
          })),
        ]),

        h(Group, { key: 'extra', title: t('group.extra') }, [
          h('p', { key: 'hint', style: S.hint }, t('extraHint')),
          h(PathList, {
            key: 'list',
            paths: extraRoots,
            removeLabel: t('remove'),
            onRemove: (item) => patch({ extraRoots: extraRoots.filter((entry) => entry !== item) }),
          }),
          h('div', { key: 'add', style: S.addRow }, [
            h('input', {
              key: 'i',
              type: 'text',
              style: S.input,
              value: extraDraft,
              placeholder: t('pathPlaceholder'),
              onChange: (event) => setExtraDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addPath('extraRoots', extraDraft, setExtraDraft);
              },
            }),
            h('button', {
              key: 'b',
              type: 'button',
              style: S.action,
              disabled: !extraDraft.trim(),
              onClick: () => addPath('extraRoots', extraDraft, setExtraDraft),
            }, t('add')),
          ]),
        ]),

        h(Group, { key: 'allowed', title: t('group.allowed') }, [
          h('p', { key: 'hint', style: S.hint }, t('allowedHint')),
          h(PathList, {
            key: 'list',
            paths: allowedRoots,
            removeLabel: t('remove'),
            onRemove: (item) => patch({ allowedRoots: allowedRoots.filter((entry) => entry !== item) }),
          }),
          h('div', { key: 'add', style: S.addRow }, [
            h('input', {
              key: 'i',
              type: 'text',
              style: S.input,
              value: allowedDraft,
              placeholder: t('pathPlaceholder'),
              onChange: (event) => setAllowedDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addPath('allowedRoots', allowedDraft, setAllowedDraft);
              },
            }),
            h('button', {
              key: 'b',
              type: 'button',
              style: S.action,
              disabled: !allowedDraft.trim(),
              onClick: () => addPath('allowedRoots', allowedDraft, setAllowedDraft),
            }, t('add')),
          ]),
        ]),

        h(Group, { key: 'status', title: t('group.status') }, [
          h('div', { key: 'row', style: S.row }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'a', style: S.rowLabel }, `${t('activeSessions')}: ${data.activeSessions}`),
              h('div', { key: 'b', style: S.rowLabel }, `${t('lastScan')}: ${lastText}`),
            ]),
            h('button', {
              key: 'scan',
              type: 'button',
              style: { ...S.action, ...(busy === 'scan' ? S.actionOff : null) },
              disabled: busy === 'scan' || state.enabled === false,
              onClick: scan,
            }, busyText),
          ]),
          last && last.errors ? h('p', { key: 'hint', style: S.hint }, t('adminHint')) : null,
        ]),

        h(Group, { key: 'log', title: t('group.log') }, [
          logs.length
            ? h('div', { key: 'rows', style: S.logs }, logs.map((entry, index) =>
                h('div', { key: `${entry.at}-${index}`, style: S.logRow }, [
                  h('span', { key: 't', style: S.logTime }, formatTime(entry.at)),
                  h('span', { key: 'k', style: S.logKind }, t(`kind.${entry.kind}`)),
                  entry.message && entry.path
                    ? h('div', { key: 'body', style: S.logBody }, [
                        h('span', { key: 'p', style: S.logPath, title: entry.path }, entry.path),
                        h('span', { key: 'm', style: S.logReason }, entry.message),
                      ])
                    : h('span', { key: 'p', style: S.logPath, title: entry.path || entry.message || '' },
                        entry.path || entry.message || ''),
                ])))
            : h('p', { key: 'empty', style: S.hint }, t('noLogs')),
        ]),
      ]);
    }

    function GuardIcon(props) {
      const size = props && props.size ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, [
        h('path', {
          key: 'shield',
          d: 'M8 1.8 13 3.7v4.1c0 3.1-2.1 5.3-5 6.4-2.9-1.1-5-3.3-5-6.4V3.7Z',
        }),
        h('path', { key: 'bar1', d: 'M5.6 6.6h4.8' }),
        h('path', { key: 'bar2', d: 'M6.6 9.1h2.8' }),
      ]);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'integrity-guard: dictionaries');
        const settingsT = ctx.locale.bind(NS);

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'integrity-guard',
          order: 40,
          label: () => settingsT('settings.title'),
          locale: NS,
        }, GuardPage)), 'integrity-guard: settings section');

        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'integrity-guard',
        }, GuardIcon)), 'integrity-guard: settings nav icon');
      },
    };
  },
});

