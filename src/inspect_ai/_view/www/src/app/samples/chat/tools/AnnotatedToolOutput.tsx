import React, { useEffect, useRef, useState } from "react";

export interface ToolAnnotation {
  action: string;
  coordinate?: [number, number];
  text?: string;
  scrollDirection?: string;
}

interface AnnotatedToolOutputProps {
  children: React.ReactNode;
  annotation?: ToolAnnotation;
}

export const AnnotatedToolOutput: React.FC<AnnotatedToolOutputProps> = ({
  children,
  annotation,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageRects, setImageRects] = useState<
    { img: HTMLImageElement; rect: DOMRect; naturalWidth: number; naturalHeight: number }[]
  >([]);

  useEffect(() => {
    if (!annotation) return;

    const updateRects = () => {
      if (!containerRef.current) return;
      const images = Array.from(containerRef.current.querySelectorAll("img"));
      const rects = images.map((img) => ({
        img,
        rect: img.getBoundingClientRect(),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }));
      setImageRects(rects);
    };

    const observer = new ResizeObserver(updateRects);
    if (containerRef.current) {
      const images = Array.from(containerRef.current.querySelectorAll("img"));
      images.forEach((img) => {
        observer.observe(img);
        img.addEventListener("load", updateRects);
      });
      updateRects();
    }

    return () => {
      observer.disconnect();
      if (containerRef.current) {
        const images = Array.from(containerRef.current.querySelectorAll("img"));
        images.forEach((img) => {
          img.removeEventListener("load", updateRects);
        });
      }
    };
  }, [annotation, children]);

  if (!annotation) {
    return <>{children}</>;
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {children}
      {imageRects.map((info, index) => {
        // Calculate scale
        const scaleX = info.rect.width / (info.naturalWidth || 1440);
        const scaleY = info.rect.height / (info.naturalHeight || 900);

        // Calculate position relative to the container
        const containerRect = containerRef.current!.getBoundingClientRect();
        const imgTop = info.rect.top - containerRect.top;
        const imgLeft = info.rect.left - containerRect.left;

        return (
          <div
            key={index}
            style={{
              position: "absolute",
              top: imgTop,
              left: imgLeft,
              width: info.rect.width,
              height: info.rect.height,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <svg
              width="100%"
              height="100%"
              style={{ position: "absolute", top: 0, left: 0 }}
            >
              {renderSvgAnnotation(annotation, scaleX, scaleY)}
            </svg>
            {renderHtmlAnnotation(annotation)}
          </div>
        );
      })}
    </div>
  );
};

function renderSvgAnnotation(
  annotation: ToolAnnotation,
  scaleX: number,
  scaleY: number
) {
  const { action, coordinate } = annotation;

  if (
    ["left_click", "right_click", "middle_click", "double_click", "triple_click"].includes(
      action
    ) &&
    coordinate
  ) {
    const [x, y] = coordinate;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;

    return (
      <g transform={`translate(${scaledX}, ${scaledY})`}>
        <circle
          cx="0"
          cy="0"
          r="16"
          stroke="rgba(239,68,68,0.8)"
          strokeWidth="3"
          fill="none"
          filter="drop-shadow(0 0 6px rgba(239,68,68,0.4))"
        />
        <svg viewBox="0 0 32 32" width="30" height="30" x="-10" y="-7">
          <g fill="none" fillRule="evenodd" transform="translate(10 7)">
            <path
              d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z"
              fill="#fff"
            />
            <path
              d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z"
              fill="#000"
            />
          </g>
        </svg>
      </g>
    );
  }

  if (action === "scroll" && coordinate) {
    const [x, y] = coordinate;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    
    let arrow = "↕";
    if (annotation.scrollDirection) {
      const dir = annotation.scrollDirection.toLowerCase();
      if (dir.includes("up")) arrow = "↑";
      else if (dir.includes("down")) arrow = "↓";
      else if (dir.includes("left")) arrow = "←";
      else if (dir.includes("right")) arrow = "→";
    }

    return (
      <g transform={`translate(${scaledX}, ${scaledY})`}>
        <circle cx="0" cy="0" r="18" fill="rgba(59,130,246,0.8)" />
        <text
          x="0"
          y="0"
          fill="white"
          fontSize="20"
          textAnchor="middle"
          dominantBaseline="central"
          fontWeight="bold"
        >
          {arrow}
        </text>
      </g>
    );
  }

  return null;
}

function renderHtmlAnnotation(annotation: ToolAnnotation) {
  const { action, text } = annotation;

  if (action === "type" || action === "key") {
    const isType = action === "type";
    const color = isType ? "#4ade80" : "#fbbf24";
    
    // For type/key annotations:
    // - Positioned at bottom of image (not at coordinates)
    // - Styled badges: type=green (#4ade80), key=amber (#fbbf24)
    // - Black background, monospace font, rounded corners
    // - Prefixed with ⌨ character
    
    // If it's a key action, it might be positioned at bottom-right
    // If it's a type action, it might be positioned at bottom-center
    const isKey = action === "key";

    return (
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          left: isKey ? "auto" : "50%",
          right: isKey ? "16px" : "auto",
          transform: isKey ? "none" : "translateX(-50%)",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          color: color,
          fontFamily: "monospace",
          padding: "6px 12px",
          borderRadius: "6px",
          fontSize: "14px",
          fontWeight: "bold",
          whiteSpace: "pre-wrap",
          maxWidth: "80%",
          wordBreak: "break-word",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
        }}
      >
        ⌨ {text || ""}
      </div>
    );
  }

  return null;
}
