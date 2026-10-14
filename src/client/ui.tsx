import { createTheme, Group, Text, ThemeIcon } from "@mantine/core";
import { IconNotebook } from "@tabler/icons-react";

export const theme = createTheme({
  primaryColor: "teal",
  primaryShade: 8,
  defaultRadius: "md",
  colors: {
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
