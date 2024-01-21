import {FC} from 'react';
import styles from './Note.module.css';

export const Note: FC<{tile: number; visible: boolean}> = ({tile, visible}) => {
  return (
    <div>
      <img
        className={styles.note}
        style={{visibility: visible ? 'visible' : 'hidden'}}
        src={`/assets/preview/assets/tile${tile
          .toString()
          .padStart(3, '0')}.png`}></img>
    </div>
  );
};
