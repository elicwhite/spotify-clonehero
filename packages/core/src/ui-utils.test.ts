import {removeStyleTags} from './ui-utils';

it('should remove style tags', () => {
  expect(removeStyleTags('<color=#AEFFFF>Aren Eternal</color> & Geo')).toBe(
    'Aren Eternal & Geo',
  );
  expect(
    removeStyleTags(
      '<color=#a5002c>M</color><color=#ff0038>i</color><color=#f84b61>s</color><color=#f2848d>c</color><color=#f6b6cd>e</color><color=#f6b6cd>l</color><color=#f2848d>l</color><color=#f84b61>a</color><color=#ff0038>n</color><color=#a5002c>y</color>, O<color=#F66>n</color><color=#FF0>y</color><color=#0FF>x</color><color=#FA4>i</color><color=#0F0>t</color><color=#F6F>e</color>',
    ),
  ).toBe('Miscellany, Onyxite');

  expect(
    removeStyleTags(
      '<color=#5F55E7>C</color><color=#5C4FE7>e</color><color=#5A49E7>r</color><color=#5843E7>u</color><color=#563EE7>l</color><color=#5438E7>e</color><color=#5232E7>a</color><color=#502CE7>n</color>',
    ),
  ).toBe('Cerulean');
});
