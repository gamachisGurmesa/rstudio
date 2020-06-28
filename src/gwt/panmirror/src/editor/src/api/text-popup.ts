/*
 * TextPopup.ts
 *
 * Copyright (C) 2020 by RStudio, PBC
 *
 * Unless you have received this program directly from RStudio pursuant
 * to the terms of a commercial license agreement with RStudio, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { DecorationSet, Decoration, EditorView } from 'prosemirror-view';
import { Selection, Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state';

import * as React from 'react';

import { getMarkRange, getMarkAttrs } from './mark';
import { kRestoreLocationTransaction } from './transaction';

import { reactRenderForEditorView } from './widgets/react';
import { textRangePopupDecorationPosition } from './widgets/decoration';
import { kPlatformMac } from './platform';
import { MarkType } from 'prosemirror-model';


export interface TextPopupTarget<AttrsType = any> {
  attrs: AttrsType;
  text: string;
}

export interface TextPopupDecoration<AttrsType = any> {
  key: PluginKey<DecorationSet>;
  markType: MarkType;
  maxWidth: number;
  createPopup: (view: EditorView, target: TextPopupTarget<AttrsType>, style: React.CSSProperties) => Promise<JSX.Element | null>;
  dismissOnEdit?: boolean;
  specKey?: (target: TextPopupTarget<AttrsType>) => string;
  filter?: (selection: Selection) => boolean;
  onCmdClick?: (target: TextPopupTarget<AttrsType>) => void;
}

export function textPopupDecorationPlugin(deco: TextPopupDecoration): Plugin<DecorationSet> {

  const { key, markType, maxWidth, createPopup, specKey, dismissOnEdit, filter, onCmdClick } = deco;

  let editorView: EditorView;

  return new Plugin<DecorationSet>({
    key,
    view(view: EditorView) {
      editorView = view;
      return {};
    },
    state: {
      init: (_config: { [key: string]: any }) => {
        return DecorationSet.empty;
      },
      apply: (tr: Transaction, old: DecorationSet, _oldState: EditorState, newState: EditorState) => {

        // if this a restore location then return empty
        if (tr.getMeta(kRestoreLocationTransaction)) {
          return DecorationSet.empty;
        }

        // if this is doc update and we have dismiss on edit then return empty
        if (dismissOnEdit && tr.docChanged) {
          return DecorationSet.empty;
        }

        // if the selection is contained within the mark then show the popup
        const selection = newState.selection;
        const range = getMarkRange(selection.$from, markType);

        if (range) {

          // apply the filter
          if (filter && !filter(selection)) {
            return DecorationSet.empty;
          }

          // don't show the link popup if it's positioned at the far left of the mark
          // (awkward when cursor is just left of an image)
          if (selection.empty && range.from === selection.from) {
            return DecorationSet.empty;
          }

          // mark target
          const attrs = getMarkAttrs(newState.doc, range, markType);
          const text = newState.doc.textBetween(range.from, range.to);
          const target = { attrs, text };

          // compute position (we need this both for setting the styles on the LinkPopup
          // as well as for setting the Decorator pos)
          const decorationPosition = textRangePopupDecorationPosition(editorView, range, maxWidth);

          // key if one was provided
          let decoratorSpec: { key: string } | undefined;
          if (specKey) {
            decoratorSpec = {
              key: specKey(target)
            };
          }

          // create decorator
          const textPopupDecorator = Decoration.widget(

            decorationPosition.pos,

            (view: EditorView, getPos: () => number) => {

              // create decorator and render popup into it
              const decorationEl = window.document.createElement('div');
              decorationEl.style.visibility = 'hidden';

              // create popup component
              createPopup(view, target, decorationPosition.style).then(popup => {
                if (popup) {
                  reactRenderForEditorView(popup, decorationEl, view);
                  decorationEl.style.visibility = 'visible';
                }
              });

              return decorationEl;

            },

            decoratorSpec
          );

          // return decorations
          return DecorationSet.create(tr.doc, [textPopupDecorator]);

        } else {

          return DecorationSet.empty;

        }
      },
    },
    props: {
      decorations: (state: EditorState) => {
        return key.getState(state);
      },
      handleClick: onCmdClick ? (view: EditorView, pos: number, event: MouseEvent) => {
        const keyPressed = kPlatformMac && event.metaKey;
        if (keyPressed) {
          const attrs = getMarkAttrs(view.state.doc, { from: pos, to: pos }, markType);
          const range = getMarkRange(view.state.doc.resolve(pos));
          if (attrs && range) {
            event.stopPropagation();
            event.preventDefault();
            const text = view.state.doc.textBetween(range.from, range.to);
            onCmdClick({ attrs, text });
            return true;
          }
        }
        return false;
      } : undefined,
    },
  });

}
