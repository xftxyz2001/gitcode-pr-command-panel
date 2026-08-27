(() => {
  "use strict";

  window.GITCODE_PR_DEFAULT_COMMANDS = [
    { id: "compile", label: "编译", command: "compile", enabled: true },
    { id: "get-log", label: "查看日志", command: "get-log", enabled: true },
    { id: "lgtm", label: "LGTM", command: "/lgtm", enabled: true },
    { id: "approve", label: "批准合入", command: "/approve", enabled: true },
    { id: "check-cla", label: "检查 CLA", command: "/check-cla", enabled: false },
    { id: "retry", label: "重试流水线", command: "retry", enabled: false },
    { id: "stop", label: "停止流水线", command: "stop", enabled: false },
    { id: "check-pr", label: "检查合入", command: "/check-pr", enabled: false },
    { id: "rebuild", label: "重新构建", command: "rebuild", enabled: false },
    { id: "system-test", label: "前冒烟", command: "system-test", enabled: false },
    { id: "cla-cancel", label: "取消 CLA", command: "/cla cancel", enabled: false },
    { id: "lgtm-cancel", label: "取消 LGTM", command: "/lgtm cancel", enabled: false },
    { id: "approve-cancel", label: "取消批准", command: "/approve cancel", enabled: false },
    { id: "merge", label: "分支管理员批准", command: "/merge", enabled: false },
    { id: "kind", label: "添加 kind", command: "/kind bug", enabled: false },
    { id: "remove-kind", label: "移除 kind", command: "/remove-kind bug", enabled: false },
    { id: "priority", label: "添加优先级", command: "/priority high", enabled: false },
    { id: "remove-priority", label: "移除优先级", command: "/remove-priority high", enabled: false },
    { id: "sig", label: "添加 SIG", command: "/sig AI", enabled: false },
    { id: "remove-sig", label: "移除 SIG", command: "/remove-sig AI", enabled: false },
    { id: "label-add", label: "添加标签", command: "/label add bug", enabled: false },
    { id: "label-remove", label: "移除标签", command: "/label remove bug", enabled: false }
  ];

  const DEFAULT_APPEARANCE = {
    buttonColor: "#ffffff",
    panelBackgroundColor: "#ffffff",
    backgroundImage: "",
    backgroundImageFit: "cover",
    backgroundOverlayOpacity: 72
  };
  const MAX_BACKGROUND_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_BACKGROUND_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_BACKGROUND_IMAGE_BYTES * 4 / 3) + 128;

  function normalizeHexColor(value, fallback) {
    const text = String(value || "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(text)) return text;
    if (/^#[0-9a-f]{3}$/.test(text)) {
      return `#${[...text.slice(1)].map((part) => part.repeat(2)).join("")}`;
    }
    return fallback;
  }

  function normalizeBackgroundImage(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > MAX_BACKGROUND_IMAGE_DATA_URL_LENGTH) return "";
    return /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(text)
      ? text.replace(/\s/g, "")
      : "";
  }

  function normalizeAppearance(value) {
    const source = value && typeof value === "object" ? value : {};
    const overlay = Number(source.backgroundOverlayOpacity);
    return {
      buttonColor: normalizeHexColor(source.buttonColor, DEFAULT_APPEARANCE.buttonColor),
      panelBackgroundColor: normalizeHexColor(
        source.panelBackgroundColor,
        DEFAULT_APPEARANCE.panelBackgroundColor
      ),
      backgroundImage: normalizeBackgroundImage(source.backgroundImage),
      backgroundImageFit: ["cover", "contain", "center"].includes(source.backgroundImageFit)
        ? source.backgroundImageFit
        : DEFAULT_APPEARANCE.backgroundImageFit,
      backgroundOverlayOpacity: Number.isFinite(overlay)
        ? Math.min(100, Math.max(0, Math.round(overlay)))
        : DEFAULT_APPEARANCE.backgroundOverlayOpacity
    };
  }

  function parseHex(color) {
    return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  }

  function mixHex(color, target, amount) {
    const sourceRgb = parseHex(color);
    const targetRgb = parseHex(target);
    return `#${sourceRgb.map((channel, index) => Math.round(
      channel + (targetRgb[index] - channel) * amount
    ).toString(16).padStart(2, "0")).join("")}`;
  }

  function relativeLuminance(background) {
    const [red, green, blue] = parseHex(background).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  function readableTextColor(background) {
    const backgroundLuminance = relativeLuminance(background);
    const lightContrast = 1.05 / (backgroundLuminance + 0.05);
    const darkContrast = (backgroundLuminance + 0.05) / 0.05;
    return lightContrast > darkContrast ? "#ffffff" : "#000000";
  }

  function createThemeTokens(value) {
    const appearance = normalizeAppearance(value);
    const usesDefaultButton = appearance.buttonColor === DEFAULT_APPEARANCE.buttonColor;
    const usesDefaultPanel = appearance.panelBackgroundColor === DEFAULT_APPEARANCE.panelBackgroundColor;
    const buttonText = usesDefaultButton ? "#182230" : readableTextColor(appearance.buttonColor);
    const panelText = usesDefaultPanel ? "#182230" : readableTextColor(appearance.panelBackgroundColor);
    const darkButton = buttonText === "#ffffff";
    const darkPanel = panelText === "#ffffff";
    const buttonHover = usesDefaultButton
      ? "#f4f7ff"
      : mixHex(appearance.buttonColor, darkButton ? "#ffffff" : "#000000", 0.12);
    const buttonActive = usesDefaultButton
      ? "#e9efff"
      : mixHex(appearance.buttonColor, "#000000", darkButton ? 0.16 : 0.20);
    return {
      ...appearance,
      buttonText,
      buttonHoverText: usesDefaultButton ? "#245bcb" : readableTextColor(buttonHover),
      buttonActiveText: usesDefaultButton ? "#245bcb" : readableTextColor(buttonActive),
      buttonHover,
      buttonActive,
      buttonBorder: usesDefaultButton
        ? "#cfd7e6"
        : mixHex(appearance.buttonColor, darkButton ? "#ffffff" : "#000000", 0.24),
      panelText,
      panelBackgroundCss: usesDefaultPanel ? "rgba(255, 255, 255, 0.98)" : appearance.panelBackgroundColor,
      panelBorder: darkPanel ? "rgba(255, 255, 255, 0.28)" : "#d8dee9",
      panelMuted: darkPanel ? "rgba(255, 255, 255, 0.76)" : "rgba(24, 34, 48, 0.68)",
      panelSurfaceHover: darkPanel ? "rgba(255, 255, 255, 0.14)" : "rgba(24, 34, 48, 0.08)",
      panelDanger: darkPanel ? "#fda29b" : "#d92d20",
      panelSuccess: darkPanel ? "#6ce9a6" : "#067647",
      overlayRgb: darkPanel ? "0, 0, 0" : "255, 255, 255"
    };
  }

  window.GITCODE_PR_APPEARANCE = {
    DEFAULTS: { ...DEFAULT_APPEARANCE },
    MAX_BACKGROUND_IMAGE_BYTES,
    normalize: normalizeAppearance,
    createThemeTokens
  };
})();
