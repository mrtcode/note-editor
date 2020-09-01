import { TextSelection } from 'prosemirror-state'
import { findParentNode } from 'prosemirror-utils';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list'
import { encodeObject, randomString } from './utils';
import { fromHtml } from './schema';

// TODO: Fix. Doesn't work with `rtl`, codeBlock probably shouldn't be here
export function changeIndent(dir = 1) {
  return function (state, dispatch, view) {
    const { selection } = state;
    const { $from, $to } = selection;
    const { paragraph, heading, bulletList, orderedList, listItem, codeBlock } = state.schema.nodes;
    const node = $to.node(1);

    if (node) {
      if (node.type === paragraph || node.type === heading) {
        let indent = node.attrs.indent;
        if (dir === 1 ? indent < 6 : indent >= 1) {
          indent += dir;
          dispatch(state.tr.setBlockType($to.pos, $to.pos, node.type, { ...node.attrs, indent }));
          return true;
        }
      }
      else if (node.type === bulletList || node.type === orderedList) {
        if (dir > 0) {
          sinkListItem(listItem)(state, dispatch);
        }
        else if (dir < 0) {
          liftListItem(listItem)(state, dispatch);
        }
        return true;
      }
      else if (node.type === codeBlock) {
        dispatch(state.tr.insert($from.pos, state.schema.text('  ', [])));
        return true;
      }
    }

    return false;
  };
}


export function hasAttr(state, attr, value) {
  let val = false;
  state.doc.nodesBetween(
    state.selection.from,
    state.selection.to,
    (node, pos) => {
      if (node.attrs[attr] === value) {
        val = true;
      }
    });

  return val;
}

export function toggleAlignment(direction) {
  return function (state, dispatch) {
    let tr = state.tr;
    let changes = false;

    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        // align nodes that support alignment
        if (node.type.attrs.align) {
          changes = true;
          if (node.attrs.align === direction) direction = null;
          tr.setNodeMarkup(pos, null, { ...node.attrs, align: direction })
        }
      });

    if (!changes) return false;
    if (dispatch) dispatch(tr);

    return true
  }
}

export function toggleDir(dir) {
  return function (state, dispatch) {
    let tr = state.tr;
    let changes = false;

    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        if (node.type.attrs.dir) {
          changes = true;
          if (node.attrs.dir === dir) dir = null;
          tr.setNodeMarkup(pos, null, { dir })
        }
      });

    if (!changes) return false;
    if (dispatch) dispatch(tr);

    return true
  }
}

export function toggleMark1(markType, attrs, force) {
  return function (state, dispatch) {
    var ref = state.selection;
    var empty = ref.empty;
    var $cursor = ref.$cursor;
    var ranges = ref.ranges;
    if ((empty && !$cursor)) {
      return false
    }
    if (dispatch) {
      if ($cursor) {
        if (!force && markType.isInSet(state.storedMarks || $cursor.marks())) {
          dispatch(state.tr.removeStoredMark(markType));
        }
        else {
          dispatch(state.tr.addStoredMark(markType.create(attrs)));
        }
      }
      else {
        var has = false, tr = state.tr;
        for (var i = 0; !has && i < ranges.length; i++) {
          var ref$1 = ranges[i];
          var $from = ref$1.$from;
          var $to = ref$1.$to;
          has = state.doc.rangeHasMark($from.pos, $to.pos, markType);
        }

        for (var i$1 = 0; i$1 < ranges.length; i$1++) {
          var ref$2 = ranges[i$1];
          var $from$1 = ref$2.$from;
          var $to$1 = ref$2.$to;
          if (!force && has) {
            tr.removeMark($from$1.pos, $to$1.pos, markType);
          }
          else {
            tr.addMark($from$1.pos, $to$1.pos, markType.create(attrs));
          }
        }
        dispatch(tr.scrollIntoView());
      }
    }
    return true
  }
}

export function insertAnnotationsAndCitations(list, pos) {
  return function (state, dispatch) {
    let nodes = [];
    for (let { annotation, citation } of list) {

      if (annotation) {
        let savedAnnotation = {
          uri: annotation.uri,
          position: annotation.position
        }

        if (annotation.image) {
          let rect = annotation.position.rects[0];
          let rectWidth = rect[2] - rect[0];
          let rectHeight = rect[3] - rect[1];
          // Constants are from pdf.js
          const CSS_UNITS = 96.0 / 72.0;
          const PDFJS_DEFAULT_SCALE = 1.25;
          let width = Math.round(rectWidth * CSS_UNITS * PDFJS_DEFAULT_SCALE);
          let height = Math.round(rectHeight * width / rectWidth);

          nodes.push(state.schema.nodes.image.create({
            width,
            height,
            annotation: savedAnnotation,
            src: annotation.image
          }));
        }

        if (annotation.comment) {
          nodes.push(...fromHtml(annotation.comment, true).content.content);
        }

        if (annotation.text) {
          if (nodes.length) {
            nodes.push(state.schema.text(' '));
          }
          nodes.push(state.schema.nodes.highlight.create({
              annotation: savedAnnotation
            },
            [
              state.schema.text('“'),
              ...fromHtml(annotation.text, true).content.content,
              state.schema.text('”')
            ]
          ));
        }

        if (nodes.length) {
          nodes.push(state.schema.text(' '));
        }
      }

      if (citation) {
        nodes.push(state.schema.nodes.citation.create({
          nodeId: randomString(),
          citation: citation
        }));
      }
    }

    if (pos) {
      dispatch(state.tr.insert(pos, nodes).setMeta('importImages', true));
    }
    else {
      dispatch(state.tr.replaceSelectionWith(nodes).setMeta('importImages', true));
    }
  }
}

function isList(node, schema) {
  return (node.type === schema.nodes.bulletList
    || node.type === schema.nodes.orderedList)
}

export function toggleList(listType, itemType) {
  return (state, dispatch, view) => {
    const { schema, selection } = state
    const { $from, $to } = selection
    const range = $from.blockRange($to)

    if (!range) {
      return false
    }

    const parentList = findParentNode(node => isList(node, schema))(selection)

    if (range.depth >= 1 && parentList && range.depth - parentList.depth <= 1) {
      if (parentList.node.type === listType) {
        return liftListItem(itemType)(state, dispatch, view)
      }

      if (isList(parentList.node, schema) && listType.validContent(parentList.node.content)) {
        const { tr } = state
        tr.setNodeMarkup(parentList.pos, listType)

        if (dispatch) {
          dispatch(tr)
        }

        return false
      }
    }

    return wrapInList(listType)(state, dispatch, view)
  }
}

export function setCitation(nodeId, citation) {
  return function (state, dispatch) {
    state.doc.descendants((node, pos) => {
      if (node.attrs.nodeId === nodeId) {
        dispatch(state.tr.setNodeMarkup(pos, null, {
          ...node.attrs,
          citation
        }));
        return false;
      }
      return true;
    });
  };
}

export function attachImportedImage(nodeId, attachmentKey) {
  return function (state, dispatch) {
    state.doc.descendants((node, pos) => {
      if (node.attrs.nodeId === nodeId) {
        dispatch(state.tr.setNodeMarkup(pos, null, {
          ...node.attrs,
          src: null,
          attachmentKey
        }).setMeta('addToHistory', false));
        return false;
      }
      return true;
    });
  };
}