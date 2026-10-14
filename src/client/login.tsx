import { useState } from "react";
import { PwaControls } from './pwa-controls';
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCheck,
  IconLock,
  IconMail,
  IconPencil,
  IconShieldCheck,
} from "@tabler/icons-react";
import { api } from "./api";
import { Brand } from "./ui";

export function Login({
  confirm = false,
  embedded = false,
}: {
  confirm?: boolean;
  embedded?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const confirming = confirm && !requesting;
  const send = async (confirming: boolean) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await api(
        confirming ? "/api/confirm" : "/api/login",
        confirming
          ? { token: new URLSearchParams(location.search).get("token") }
          : { email },
      );
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "登入失敗，請稍後重試");
        return;
      }
      if (confirming) {
        history.replaceState(null, "", "/");
        location.replace(sessionStorage.getItem("p-note-return-url") ?? "/");
      } else setMessage(data.message ?? "請查看登入郵件");
    } catch {
      setError("連線失敗，請稍後重試");
    } finally {
      setBusy(false);
    }
  };
  const card = (
    <Paper
      className="login-card"
      radius="xl"
      p="xl"
      withBorder
      component="section"
      aria-label="登入"
    >
      <Stack gap="lg">
        <ThemeIcon variant="light" size={52} radius={16}>
          <IconPencil size={26} stroke={1.7} />
        </ThemeIcon>
        <div>
          <Title order={2} size={26}>
            登入 p-note
          </Title>
          <Text mt={8} c="dimmed" lh={1.7}>
            {confirming
              ? "確認後，就可以回到你的筆記。"
              : "不需要密碼。我們會寄送一次性登入連結到你的信箱。"}
          </Text>
        </div>
        {confirming ? (
          <>
            <Button
              loading={busy}
              leftSection={<IconCheck size={18} />}
              onClick={() => {
                void send(true);
              }}
            >
              確認登入
            </Button>
            <Text size="sm" c="dimmed">
              連結只能使用一次，請勿轉寄。
            </Text>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(false);
            }}
          >
            <Stack gap="md">
              <TextInput
                label="Email"
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                leftSection={<IconMail size={18} />}
              />
              <Button
                fullWidth
                type="submit"
                loading={busy}
                rightSection={<IconArrowRight size={18} />}
              >
                寄送登入連結
              </Button>
            </Stack>
          </form>
        )}
        {message && (
          <Alert
            color="teal"
            icon={<IconCheck size={20} />}
            role="status"
            title="登入連結已申請"
          >
            {message}
            <Text size="sm" mt={6}>
              請開啟信中的連結，再按下確認登入。
            </Text>
          </Alert>
        )}
        {error && (
          <Alert color="red" role="alert" title="暫時無法登入">
            {error}
          </Alert>
        )}
        {confirming && (
          <Button
            variant="subtle"
            onClick={() => {
              setRequesting(true);
              setError("");
              setMessage("");
            }}
          >
            重新申請登入連結
          </Button>
        )}
        <Group gap={6} wrap="nowrap" justify="center" c="dimmed">
          <IconLock size={14} />
          <Text size="xs">僅限已設定的擁有者登入</Text>
        </Group>
      </Stack>
    </Paper>
  );
  if (embedded) return card;
  return (
    <main className="login-page">
      <div className="login-layout">
        <section className="login-intro">
          <Brand />
          <div className="intro-copy">
            <Text className="eyebrow" c="teal.8">
              私人筆記與日記
            </Text>
            <h1>
              給想法一個家，
              <br />
              給日常一頁空間。
            </h1>
            <Text c="dimmed" size="lg" lh={1.8}>
              安靜寫下靈感，慢慢記錄生活。
              <br />
              你的筆記與日記，都留在自己的空間。
            </Text>
          </div>
          <Group gap="xs" c="dimmed">
            <IconShieldCheck size={18} />
            <Text size="sm">私人工作區 · 自動保存 · 隨時續寫</Text>
          </Group>
        </section>
        {card}
      </div>
      <Text className="login-footer" size="xs" c="dimmed">
        一個屬於你的，安靜寫作的地方。
      </Text>
      <div style={{ margin: '12px auto 0' }}><PwaControls /></div>
    </main>
  );
}
