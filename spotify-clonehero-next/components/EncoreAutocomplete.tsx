import {useCombobox} from 'downshift';
import {useCallback, useState} from 'react';
import {Searcher} from 'fast-fuzzy';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {Input} from '@/components/ui/input';
import {Button} from './ui/button';
import {cn} from '@/lib/utils';

export default function EncoreAutocomplete({
  searcher,
  onChartSelected,
}: {
  searcher: Searcher<
    ChartResponseEncore,
    {
      keySelector: (chart: ChartResponseEncore) => string[];
      threshold: number;
    }
  > | null;
  onChartSelected: (chart: ChartResponseEncore) => void;
}) {
  const [items, setItems] = useState<ChartResponseEncore[]>([]);
  const {
    isOpen,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    selectedItem,
  } = useCombobox({
    onInputValueChange({inputValue}) {
      if (inputValue) {
        const result = searcher?.search(inputValue);
        console.log(result);
        setItems(result?.slice(0, 10) ?? []);
      }
    },
    items,
    itemToString(item) {
      return item ? item.name : '';
    },
  });

  const buttonHandler = useCallback(() => {
    if (selectedItem == null) return;

    onChartSelected(selectedItem);
  }, [onChartSelected, selectedItem]);

  return (
    <div>
      <div className="w-72 flex flex-col gap-1">
        <div className="flex w-full max-w-sm items-center space-x-2">
          <Input placeholder="Search" {...getInputProps()} />
          <Button
            type="submit"
            disabled={selectedItem == null}
            onClick={buttonHandler}>
            Play
          </Button>
        </div>
        <div className="flex shadow-sm gap-0.5"></div>
      </div>
      <ul
        className={`absolute w-72 mt-1 shadow-md max-h-80 overflow-scroll p-0 z-10 ${
          !(isOpen && items.length) && 'hidden'
        }`}
        {...getMenuProps()}>
        {isOpen &&
          items.map((item, index) => (
            <li
              className={cn(
                'flex flex-col cursor-default select-none rounded-sm px-2 py-1.5 text-sm outline-none transition-colors bg-background',
                highlightedIndex === index &&
                  'bg-accent text-accent-foreground',
                selectedItem === item && 'font-bold',
              )}
              key={item.md5}
              {...getItemProps({item, index})}>
              <span>{item.name}</span>
              <span className="text-sm">{item.artist}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
