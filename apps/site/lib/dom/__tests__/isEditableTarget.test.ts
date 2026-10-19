/** @jest-environment jsdom */
import {isEditableTarget} from '../isEditableTarget';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isEditableTarget', () => {
  it('is true for text-entry elements', () => {
    const host = mount(
      '<input /><textarea></textarea><select></select>' +
        '<div contenteditable="true"><span id="inner">x</span></div>',
    );
    expect(isEditableTarget(host.querySelector('input'))).toBe(true);
    expect(isEditableTarget(host.querySelector('textarea'))).toBe(true);
    expect(isEditableTarget(host.querySelector('select'))).toBe(true);
    expect(isEditableTarget(host.querySelector('[contenteditable]'))).toBe(
      true,
    );
    expect(isEditableTarget(host.querySelector('#inner'))).toBe(true);
  });

  it('is false for everything else', () => {
    const host = mount(
      '<button>Accept</button><div id="plain"></div>' +
        '<div contenteditable="false"><span id="off">x</span></div>',
    );
    expect(isEditableTarget(host.querySelector('button'))).toBe(false);
    expect(isEditableTarget(host.querySelector('#plain'))).toBe(false);
    expect(isEditableTarget(host.querySelector('[contenteditable]'))).toBe(
      false,
    );
    expect(isEditableTarget(host.querySelector('#off'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
