import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}
    >
      {children}
    </svg>
  );
}

export const IconOrbit = (p: P) => (
  <Svg {...p}><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-25 12 12)" /><circle cx="12" cy="12" r="2.2" /></Svg>
);
export const IconFly = (p: P) => (
  <Svg {...p}><path d="M3 11.5 21 4l-5.5 16-3.5-6.5L3 11.5Z" /><path d="m12 13.5 3.5-4" /></Svg>
);
export const IconCamera = (p: P) => (
  <Svg {...p}><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4V8Z" /><circle cx="12" cy="13.2" r="3.4" /></Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /><path d="m4 4 16 16" /></Svg>
);
export const IconHelp = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8" /><circle cx="12" cy="16.9" r=".6" fill="currentColor" /></Svg>
);
export const IconPanel = (p: P) => (
  <Svg {...p}><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M14.5 5v14" /></Svg>
);
export const IconDice = (p: P) => (
  <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}><path d="m7 10 5 5 5-5" /></Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /><path d="M5 19.5h14" /></Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
);
export const IconReset = (p: P) => (
  <Svg {...p}><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" /><path d="M4 4.5v4h4" /></Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}><path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7" /></Svg>
);
export const IconSave = (p: P) => (
  <Svg {...p}><path d="M5 4h11l3 3v13H5V4Z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></Svg>
);
export const IconImport = (p: P) => (
  <Svg {...p}><path d="M12 15V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 19.5h14" /></Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="7" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5" /></Svg>
);
export const IconExit = (p: P) => (
  <Svg {...p}><path d="M10 5H5.5v14H10" /><path d="M14 8.5 17.5 12 14 15.5M17.5 12H9" /></Svg>
);
