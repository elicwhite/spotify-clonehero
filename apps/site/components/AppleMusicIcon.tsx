import Image from 'next/image';

import {cn} from '@/lib/utils';

export type AppleMusicIconProps = {
  variant?: 'color' | 'white';
  className?: string;
};

const iconSources = {
  color: '/assets/apple-music/apple-music-icon-color.svg',
  white: '/assets/apple-music/apple-music-icon-white.svg',
} as const;

/** Official Apple Music artwork. Adjacent text owns the accessible name. */
export default function AppleMusicIcon({
  variant = 'color',
  className,
}: AppleMusicIconProps) {
  return (
    <Image
      src={iconSources[variant]}
      width={73}
      height={73}
      alt=""
      aria-hidden="true"
      className={cn('shrink-0', className)}
    />
  );
}
