import { useState, useEffect } from 'react';

export function useIsMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < bp : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < bp);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bp]);

  return isMobile;
}
