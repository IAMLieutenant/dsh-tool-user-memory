// DSH browser entry: open the manager from the bundle's own detail page.
window.__ModuleLoader__.load({
  id: 'dsh-tool-user-memory',
  factory: function (require) {
    var React = require('react');
    return {
      name: 'user-memory-manager',
      inject: ['slots'],
      apply: function (ctx) {
        var dialog = null;
        var themeObserver = null;
        function closeManager() {
          if (!dialog) return;
          if (themeObserver) themeObserver.disconnect();
          themeObserver = null;
          var current = dialog;
          dialog = null;
          if (current.open) current.close();
          current.remove();
        }
        function openManager(entry) {
          if (dialog) return;
          var previousFocus = document.activeElement;
          dialog = document.createElement('dialog');
          dialog.setAttribute('aria-label', '记忆管理');
          Object.assign(dialog.style, {
            width: 'min(680px, 92vw)', height: 'min(500px, 82vh)',
            maxWidth: '92vw', maxHeight: '82vh', padding: '0',
            border: '1px solid var(--dsw-alias-border-l2, #dcdce0)', borderRadius: '20px',
            background: 'var(--dsw-alias-bg-layer-1, Canvas)',
            color: 'var(--dsw-alias-label-primary, CanvasText)', overflow: 'hidden',
            font: 'inherit', boxShadow: '0 16px 60px #00000026'
          });
          var layout = document.createElement('div');
          Object.assign(layout.style, { display: 'flex', flexDirection: 'column', height: '100%' });
          var header = document.createElement('header');
          Object.assign(header.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 22px', borderBottom: '1px solid var(--dsw-alias-border-l2, #dcdce0)', flexShrink: '0'
          });
          var title = document.createElement('strong');
          title.textContent = '记忆管理';
          var close = document.createElement('button');
          close.type = 'button';
          close.textContent = '关闭';
          close.setAttribute('aria-label', '关闭记忆管理');
          Object.assign(close.style, {
            border: 'none', borderRadius: '12px', padding: '7px 12px',
            background: 'var(--dsw-alias-interactive-bg-hover, #00000008)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '13px'
          });
          close.addEventListener('click', closeManager);
          var frame = document.createElement('iframe');
          frame.src = '/_dsh/user-memory?embedded=1&theme=' + (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light');
          if (entry && typeof entry.sessionId === 'string') frame.src += '&session=' + encodeURIComponent(entry.sessionId) + '&turn=' + encodeURIComponent(entry.turn) + '&tab=' + encodeURIComponent(entry.tab);
          frame.title = '用户记忆';
          frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
          Object.assign(frame.style, { width: '100%', flex: '1', minHeight: '0', border: '0' });
          // Read DSH's resolved palette, including its custom theme overrides.
          function syncTheme() {
            var root = frame.contentDocument && frame.contentDocument.documentElement;
            if (!root) return;
            root.dataset.theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
            var palette = getComputedStyle(document.body);
            var tokens = {
              '--memory-bg': '--dsw-alias-bg-layer-1',
              '--memory-surface': '--dsw-alias-bg-module-platform',
              '--memory-text': '--dsw-alias-label-primary',
              '--memory-muted': '--dsw-alias-label-secondary',
              '--memory-border': '--dsw-alias-border-l2',
              '--memory-hover': '--dsw-alias-interactive-bg-hover'
            };
            Object.keys(tokens).forEach(function (name) {
              var value = palette.getPropertyValue(tokens[name]).trim();
              if (value) root.style.setProperty(name, value);
            });
            root.style.setProperty('--memory-font', palette.fontFamily);
          }
          frame.addEventListener('load', syncTheme);
          themeObserver = new MutationObserver(syncTheme);
          themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });
          themeObserver.observe(document.documentElement, { attributes: true });
          themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
          header.append(title, close);
          layout.append(header, frame);
          dialog.append(layout);
          dialog.addEventListener('close', function () {
            closeManager();
            if (previousFocus && previousFocus.isConnected) previousFocus.focus();
          }, { once: true });
          document.body.append(dialog);
          dialog.showModal();
          close.focus();
        }
        ctx.effect(function () { return closeManager; });
        ctx.effect(function () {
          return ctx.slots.inject('plugins.bundle.config', function () {
            return ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-tool-user-memory' }, function () {
              return React.createElement('div', { style: { padding: '12px 0' } },
                React.createElement('button', { type: 'button', onClick: openManager }, '管理记忆'),
                React.createElement('p', null, '查看和修改用户记忆。'));
            });
          });
        });
        ctx.effect(function () {
          return ctx.slots.inject('conversation.chat.turnTail', function () {
            return ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'user-memory', order: 30,
              inject: function (sessionId) { return {
                sessionId: sessionId,
                remember: function (turn) { openManager({ sessionId: sessionId, turn: turn, tab: 'capture' }); }
              }; }
            }, function (props) {
              var turn = typeof props.turn === 'number' ? props.turn : props.turn && props.turn.turn;
              var automaticState = React.useState({ items: [], token: '', error: '' }), automatic = automaticState[0], setAutomatic = automaticState[1];
              React.useEffect(function () {
                if (!props.sessionId || !Number.isSafeInteger(turn)) return;
                var active = true;
                function refresh() {
                  fetch('/_dsh/user-memory/automatic?session=' + encodeURIComponent(props.sessionId) + '&turn=' + turn)
                    .then(function (r) { return r.json(); }).then(function (r) { if (active && r.ok) setAutomatic({ items: r.items, token: r.token, error: '' }); }).catch(function () {});
                }
                refresh(); var later = setTimeout(refresh, 1500), last = setTimeout(refresh, 4000);
                return function () { active = false; clearTimeout(later); clearTimeout(last); };
              }, [props.sessionId, turn, props.turn]);
              if (!Number.isSafeInteger(turn) || turn < 0) return null;
              function undo(item) {
                fetch('/_dsh/user-memory/automatic', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Memory-Token': automatic.token }, body: JSON.stringify({ key: item.key, id: item.id }) })
                  .then(function (r) { return r.json(); }).then(function (r) {
                    if (!r.ok) throw new Error(r.error || '撤销未完成');
                    setAutomatic(function (state) { return { items: state.items.filter(function (n) { return n.id !== item.id; }), token: state.token, error: '' }; });
                  }).catch(function (e) { setAutomatic(function (state) { return { items: state.items, token: state.token, error: e.message }; }); });
              }
              return React.createElement('div', { style: { display: 'flex', gap: '12px', padding: '4px 0', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                React.createElement('button', { type: 'button', onClick: function () { props.remember(turn); }, style: { font: 'inherit', color: 'inherit', border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0' } }, '记住'),
                automatic.items.map(function (item) { return React.createElement('span', { key: item.id, style: { display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, '已记住：' + item.value,
                  React.createElement('button', { type: 'button', 'aria-label': '撤销记忆 ' + item.key, onClick: function () { undo(item); }, style: { font: 'inherit', color: 'inherit', border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0' } }, '撤销')); }),
                automatic.error ? React.createElement('span', { role: 'status' }, automatic.error) : null);
            });
          });
        });
      }
    };
  }
});
