import {
  createTheme,
  defaultVariantColorsResolver,
  darken,
  parseThemeColor,
  Group,
  Text,
  ThemeIcon,
  type CSSVariablesResolver,
} from "@mantine/core";
import { IconNotebook } from "@tabler/icons-react";

export const interactionColors = {
  hover: "#edf1eb",
  text: "#243532",
  selected: "#dce9df",
  selectedHover: "#cdddce",
};

export const theme = createTheme({
  primaryColor: "teal",
  primaryShade: 8,
  defaultRadius: "md",
  // dark 色盤的 light-hover 是中灰，淺色介面的中性操作改用共用淺底。
  variantColorResolver: (input) => {
    const defaults = defaultVariantColorsResolver(input);
    const parsed = parseThemeColor({ color: input.color ?? input.theme.primaryColor, theme: input.theme });
    // 最深色階不能退回較淺一階，否則白字在 hover 後會失去對比。
    if (input.variant === "filled" && parsed.isThemeColor && parsed.shade === 9) {
      return { ...defaults, hover: darken(input.theme.colors[parsed.color][9], 0.1) };
    }
    if (["gray", "dark"].includes(input.color ?? "") && ["subtle", "light"].includes(input.variant)) {
      return {
        ...defaults,
        hover: "var(--p-note-hover-bg)",
        color: "var(--p-note-interactive-text)",
      };
    }
    return defaults;
  },
  colors: {
    // 最深橘色用於覆蓋還原，確保一般狀態的白字也達到 4.5:1。
    orange: ["#fff4e6", "#ffe8cc", "#ffd8a8", "#ffc078", "#ffa94d", "#ff922b", "#fd7e14", "#f76707", "#e8590c", "#c9400d"],
    teal: [
      "#eff6f1",
      "#dcece2",
      "#bddccc",
      "#98c6b0",
      "#70ae93",
      "#499377",
      "#2b7b62",
      "#20694f",
      "#185b43",
      "#104735",
    ],
  },
  fontFamily: 'Inter, "Noto Sans TC", system-ui, sans-serif',
  headings: {
    fontFamily: 'Inter, "Noto Sans TC", system-ui, sans-serif',
    fontWeight: "650",
  },
  components: {
    Button: { defaultProps: { size: "sm", h: 44, fw: 600 } },
    ActionIcon: { defaultProps: { size: 44, variant: "subtle" } },
    TextInput: { defaultProps: { size: "md", withAsterisk: false } },
    NativeSelect: { defaultProps: { size: "md" } },
    Modal: {
      defaultProps: {
        radius: "lg",
        padding: "xl",
        overlayProps: { backgroundOpacity: 0.35, blur: 3 },
      },
    },
    Drawer: {
      defaultProps: {
        padding: "lg",
        overlayProps: { backgroundOpacity: 0.35, blur: 3 },
      },
    },
  },
});

// Mantine 預設 dimmed（gray.6）在淺底小字只有約 3.3:1，未達 WCAG AA。
export const resolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": "#5c6862",
    "--p-note-hover-bg": interactionColors.hover,
    "--p-note-interactive-text": interactionColors.text,
    "--p-note-selected-bg": interactionColors.selected,
    "--p-note-selected-hover-bg": interactionColors.selectedHover,
    "--mantine-color-default-hover": interactionColors.hover,
    "--mantine-color-red-light": "var(--mantine-color-red-0)",
    "--mantine-color-red-light-hover": "var(--mantine-color-red-1)",
  },
  dark: {},
});

export function Brand() {
  return (
    <Group gap={10} wrap="nowrap">
      <ThemeIcon size={36} radius={12} color="teal.8">
        <IconNotebook size={22} stroke={1.8} />
      </ThemeIcon>
      <Text fw={750} size="xl" c="dark.8" style={{ letterSpacing: "-0.7px" }}>
        p-note
      </Text>
    </Group>
  );
}
