import { Plugin, PluginKey } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';

function getAttachmentKeys(state) {
  let attachmentKeys = [];
  state.tr.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.attachmentKey) {
      attachmentKeys.push(node.attrs.attachmentKey);
    }
  });
  return attachmentKeys;
}

export let imageKey = new PluginKey('image');

export function image(options) {
  let prevAttachmentKeys = null;
  return new Plugin({
    key: imageKey,
    appendTransaction(transactions, oldState, newState) {
      let newTr = newState.tr

      let changed = transactions.some(tr => tr.docChanged);

      if (!changed) return;

      let attachmentKeys = getAttachmentKeys(newState);
      if (changed && !prevAttachmentKeys) {
        options.onSyncAttachmentKeys(attachmentKeys);
      }
      else if (JSON.stringify(attachmentKeys) !== JSON.stringify(prevAttachmentKeys)) {
        options.onSyncAttachmentKeys(attachmentKeys);
      }
      prevAttachmentKeys = attachmentKeys


      let updatedDimensions = false;
      if (changed) {
        newState.doc.descendants((node, pos) => {
          if (node.type.name === 'image'
            && options.dimensionsStore.data[node.attrs.nodeId]) {
            let [width, height] = options.dimensionsStore.data[node.attrs.nodeId];
            newTr = newTr.setNodeMarkup(pos, null, {
              ...node.attrs,
              naturalWidth: width,
              naturalHeight: height
            });
            updatedDimensions = true;
          }
        });

        options.dimensionsStore.data = {};
      }

      let images = [];
      transactions.forEach(tr => {
        tr.steps.forEach(step => {
          if (tr.getMeta('importImages') && step instanceof ReplaceStep && step.slice) {
            step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
              newState.doc.nodesBetween(newStart, newEnd, (parentNode, parentPos) => {
                parentNode.forEach((node, offset) => {
                  let absolutePos = parentPos + offset + 1;
                  if (node.type.name === 'image' && !node.attrs.attachmentKey) {
                    images.push({ nodeId: node.attrs.nodeId, src: node.attrs.src });
                    newTr = newTr.setNodeMarkup(absolutePos, null, {
                      ...node.attrs,
                      // Unset src to make sure the image data won't be save
                      // into the document
                      src: null
                    });
                  }
                });
              });
            });
          }
        });
      });

      if (images.length) {
        options.onImportImages(images);
      }

      if (updatedDimensions || images.length) {
        return newTr
      }
    }
  });
}