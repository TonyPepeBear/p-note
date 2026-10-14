import { createTheme, defaultVariantColorsResolver, darken, parseThemeColor, Group, Text, type CSSVariablesResolver } from "@mantine/core";
import { IconNotebook } from "@tabler/icons-react";

const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", Helvetica, Arial, sans-serif';

export const theme = createTheme({
  primaryColor: "blue",
  primaryShade: 7,
  defaultRadius: "sm",
  fontFamily,
  variantColorResolver: (input) => {
    const defaults = defaultVariantColorsResolver(input);
    const parsed = parseThemeColor({ color: input.color ?? input.theme.primaryColor, theme: input.theme });
    if (input.variant === "filled" && parsed.isThemeColor && parsed.shade === 9) {
      return { ...defaults, hover: darken(input.theme.colors[parsed.color][9], 0.1) };
    }
    if (["gray", "dark"].includes(input.color ?? "") && ["subtle", "light"].includes(input.variant)) {
      return { ...defaults, hover: "#efefed", color: "#57564f" };
    }
    return defaults;
  },
  fontSizes: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "18px" },
  radius: { xs: "3px", sm: "4px", md: "6px", lg: "8px", xl: "10px" },
  headings: { fontFamily, fontWeight: "650" },
  colors: {
    orange: ["#fff4e6", "#ffe8cc", "#ffd8a8", "#ffc078", "#ffa94d", "#ff922b", "#fd7e14", "#f76707", "#e8590c", "#c9400d"],
    gray: ["#f7f7f5", "#f1f1ef", "#e9e9e7", "#d9d9d6", "#b6b5b2", "#92918d", "#6f6e69", "#57564f", "#37352f", "#25241f"],
    blue: ["#f0f7fe", "#e5f1fc", "#cce4f9", "#a6d0f3", "#72b4eb", "#4397e2", "#2383e2", "#176dc1", "#135a9e", "#104b83"],
  },
  components: {
    Button: { defaultProps: { size: "sm", fw: 500 } },
    ActionIcon: { defaultProps: { size: 32, variant: "subtle", color: "gray" } },
    TextInput: { defaultProps: { size: "sm", withAsterisk: false } },
    NativeSelect: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    MultiSelect: { defaultProps: { size: "sm" } },
    Checkbox: { defaultProps: { size: "sm" } },
    Modal: { defaultProps: { radius: "lg", padding: "lg", overlayProps: { backgroundOpacity: 0.25 }, transitionProps: { duration: 120 }, closeButtonProps: { "aria-label": "關閉對話框" } } },
    Drawer: { defaultProps: { padding: "sm", overlayProps: { backgroundOpacity: 0.25 }, transitionProps: { duration: 120 } } },
    Tooltip: { defaultProps: { openDelay: 400, withArrow: false } },
    Alert: { defaultProps: { radius: "sm" } },
  },
});

export const resolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-text": "#37352f",
    "--mantine-color-body": "#ffffff",
    "--mantine-color-dimmed": "#6f6e69",
    "--mantine-color-default-border": "#e9e9e7",
    "--p-note-hover-bg": "#efefed",
    "--p-note-interactive-text": "#37352f",
    "--p-note-selected-bg": "#e9e9e7",
    "--p-note-selected-hover-bg": "#dededb",
    "--mantine-color-default-hover": "#efefed",
    "--mantine-color-red-light": "var(--mantine-color-red-0)",
    "--mantine-color-red-light-hover": "var(--mantine-color-red-1)",
  },
  dark: {},
});

export function Brand() {
  return (
    <Group gap={8} wrap="nowrap" className="workspace-brand">
      <span className="brand-mark"><IconNotebook size={20} stroke={1.7} /></span>
      <Text fw={650} size="md" style={{ letterSpacing: "-0.3px" }}>p-note</Text>
    </Group>
  );
}
