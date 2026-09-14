// 랜딩과 같은 라인 스타일: 24 그리드, stroke 1.8, 둥근 끝처리.
// 색은 currentColor로 상속받는다. 컴포넌트에서 색을 지정하지 않는다.

const Svg = ({ size = 20, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const Home = (p) => (
  <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-6h5v6" /></Svg>
);
export const Upload = (p) => (
  <Svg {...p}><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Svg>
);
export const Folder = (p) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);
export const FolderOpen = (p) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v1.5H3z" /><path d="M3 11h18l-2 8a1.5 1.5 0 0 1-1.5 1H5a2 2 0 0 1-2-2z" /></Svg>
);
export const Calendar = (p) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M16 3v4M8 3v4M3 10h18" /></Svg>
);
export const ListCheck = (p) => (
  <Svg {...p}><path d="M4 7.5 6 9.5l3-3.5" /><path d="M4 16.5 6 18.5l3-3.5" /><path d="M12.5 8h7.5M12.5 17h7.5" /></Svg>
);
export const CheckCircle = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Svg>
);
export const User = (p) => (
  <Svg {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.7 4-5.6 7.5-5.6s6.3 1.9 7.5 5.6" /></Svg>
);
export const Search = (p) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);
export const Bell = (p) => (
  <Svg {...p}><path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 8-2.5 8h17S18 15 18 9" /><path d="M13.7 20.5a2 2 0 0 1-3.4 0" /></Svg>
);
export const Trash = (p) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" /><path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2A1.5 1.5 0 0 0 16.6 19L17.5 7" /></Svg>
);
export const Pencil = (p) => (
  <Svg {...p}><path d="M15.5 4.5 19.5 8.5 8 20H4v-4z" /><path d="m13.5 6.5 4 4" /></Svg>
);
export const Close = (p) => (
  <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
);
export const ChevronDown = (p) => (
  <Svg {...p}><path d="m6 9.5 6 6 6-6" /></Svg>
);
export const ChevronRight = (p) => (
  <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>
);
export const ArrowLeft = (p) => (
  <Svg {...p}><path d="M20 12H4" /><path d="m9.5 6.5-5.5 5.5 5.5 5.5" /></Svg>
);
export const FileText = (p) => (
  <Svg {...p}><path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v5.5H19" /><path d="M8.5 13h7M8.5 16.5h4.5" /></Svg>
);
export const Inbox = (p) => (
  <Svg {...p}><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M4.5 6.5 3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-1.5-6.5A2 2 0 0 0 17.6 5H6.4a2 2 0 0 0-1.9 1.5z" /></Svg>
);
export const Lock = (p) => (
  <Svg {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Svg>
);
export const Sparkle = (p) => (
  <Svg {...p}><path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.1 10.2 12.6 4.5 10.8 10.2 9z" /><path d="M18.5 16.5 19.2 18.6 21.3 19.3 19.2 20 18.5 22.1 17.8 20 15.7 19.3 17.8 18.6z" /></Svg>
);
