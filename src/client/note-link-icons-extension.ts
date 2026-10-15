import { createExtension, type BlockNoteEditor } from '@blocknote/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { noteLinkId } from '../shared/note-links';
import type { PageRow } from '../shared/pages';

type IconHost = { element: HTMLElement; id: string; key: string };

/** 初始化時安裝裝飾，避免重設外掛而破壞協作編輯器的復原紀錄。 */
export function createNoteLinkIconsExtension() {
  const key = new PluginKey('p-note-link-icons');
  const listeners = new Set<() => void>();
  let visible = new Set<string>();
  let hosts: IconHost[] = [];
  let sequence = 0;
  let scheduled = false;
  const notify = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      listeners.forEach(listener => listener());
    });
  };
  const extension = createExtension({
    key: 'p-note-link-icons',
    prosemirrorPlugins: [new Plugin({
      key,
      props: {
        decorations(state) {
          const widgets: Decoration[] = [];
          let previousEnd = -1;
          let previousId: string | undefined;
          state.doc.descendants((node, position) => {
            if (!node.isText) return;
            const id = noteLinkId(node.marks.find(mark => mark.type.name === 'link')?.attrs.href);
            if (id && visible.has(id) && !(previousId === id && previousEnd === position)) {
              widgets.push(Decoration.widget(position, () => {
                const element = document.createElement('span');
                element.className = 'note-inline-icon';
                element.contentEditable = 'false';
                element.dataset.noteLinkId = id;
                hosts = [...hosts, { element, id, key: id + ':' + sequence++ }];
                notify();
                return element;
              }, {
                key: id + ':' + position,
                side: -1,
                marks: [],
                stopEvent: () => true,
                ignoreSelection: true,
                destroy: element => {
                  hosts = hosts.filter(host => host.element !== element);
                  notify();
                },
              }));
            }
            previousEnd = position + node.nodeSize;
            previousId = id;
          });
          return DecorationSet.create(state.doc, widgets);
        },
      },
    })],
  });
  return {
    extension,
    getHosts: () => hosts,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPages: (pages: PageRow[], editor: BlockNoteEditor) => {
      const previous = visible;
      visible = new Set(pages.map(page => page.id));
      if (previous.size === visible.size && [...previous].every(id => visible.has(id))) return;
      if (editor._tiptapEditor.isDestroyed) return;
      const view = editor._tiptapEditor.view;
      let changed = false;
      view.state.doc.descendants(node => {
        if (changed || !node.isText) return;
        const id = noteLinkId(node.marks.find(mark => mark.type.name === 'link')?.attrs.href);
        if (id && previous.has(id) !== visible.has(id)) changed = true;
      });
      // 僅連結目標可見性改變需要重繪裝飾；圖示值由 React 更新，不另送編輯交易。
      if (changed) view.dispatch(view.state.tr.setMeta(key, true));
    },
  };
}
