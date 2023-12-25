import {ReactNode} from 'react';

export default function Button({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      {...(disabled
        ? {
            disabled: true,
            title: "Can't have two charts from the same charter",
          }
        : {})}
      className={
        'bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 dark:bg-blue-400' +
        (disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:bg-blue-600 dark:hover:bg-blue-500')
      }
      onClick={onClick}>
      {children}
    </button>
  );
}
