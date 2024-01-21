import React, {FC, PropsWithChildren, ReactNode} from 'react';
import {Note} from './Note';
import styles from './NoteRow.module.css';

export const NoteRow: FC<{
  style?: React.CSSProperties;
  note: number;
  // children: ReactNode;
}> = ({style, note}) => {
  return (
    <div className={styles.noteRow} style={style}>
      <Note tile={0} visible={note == 0}></Note>
      <Note tile={1} visible={note == 1}></Note>
      <Note tile={2} visible={note == 2}></Note>
      <Note tile={3} visible={note == 3}></Note>
      <Note tile={4} visible={note == 4}></Note>
      {/* {children} */}
    </div>
  );
};
