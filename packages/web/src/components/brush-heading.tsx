import React from 'react';

/** The bundled brush face has deep tails beyond an ordinary text line box.
 * Measure the loaded face so only titles that need it receive extra leading. */
export function BrushHeading({
  as: Tag = 'h1',
  minLineHeight = 1.28,
  children,
  style,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: 'h1' | 'h2' | 'h3' | 'strong';
  minLineHeight?: number;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const attach = React.useCallback((node: HTMLElement | null) => { ref.current = node; }, []);
  const measured = React.useRef('');
  const [lineHeight, setLineHeight] = React.useState(minLineHeight);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !document.fonts) return;
    let active = true;
    let version = 0;
    const measure = () => {
      const request = ++version;
      const text = node.textContent?.trim();
      if (!text) return;
      const computed = getComputedStyle(node);
      const family = computed.fontFamily.split(',')[0].trim();
      const primary = `${computed.fontStyle} ${computed.fontWeight} 1000px ${family}`;
      const font = `${computed.fontStyle} ${computed.fontWeight} 1000px ${computed.fontFamily}`;
      const key = `${font}|${minLineHeight}|${text}`;
      if (measured.current === key) return;
      void document.fonts.load(primary, text).then((faces) => {
        // A missing web font must not cache a fallback face's measurements.
        if (!active || request !== version || !faces.some((face) => face.status === 'loaded')) return;
        const context = document.createElement('canvas').getContext('2d');
        if (!context) return;
        context.font = font;
        const ink = context.measureText(text);
        const height = (ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent) / 1000;
        if (!Number.isFinite(height) || height <= 0) return;
        const leading = Math.max(minLineHeight, Math.ceil((height + 0.12) * 100) / 100);
        measured.current = key;
        setLineHeight(leading);
      }).catch(() => {
        // The CSS fallback remains readable if the bundled face cannot load.
      });
    };
    // Translated child components can change their text without new props here.
    const observer = new MutationObserver(measure);
    observer.observe(node, { childList: true, characterData: true, subtree: true });
    // The shell applies desktop font rules after its children first mount.
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-host'] });
    measure();
    return () => { active = false; observer.disconnect(); };
  }, [Tag, children, minLineHeight]);
  return <Tag {...props} ref={attach} style={{ ...style, lineHeight: Math.max(minLineHeight, lineHeight) }}>{children}</Tag>;
}
