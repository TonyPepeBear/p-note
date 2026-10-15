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
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCheck,
  IconLock,
  IconMail,
} from "@tabler/icons-react";
import { api } from "./api";
import { oauthReturnTo } from '../shared/oauth';
import { Brand } from "./ui";
import "./login.css";

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
  const returnTo = oauthReturnTo(new URLSearchParams(location.search).get('returnTo'));
  const send = async (confirming: boolean) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await api(
        confirming ? "/api/confirm" : "/api/login",
        confirming
          ? { token: new URLSearchParams(location.search).get("token") }
          : { email, ...(returnTo ? { returnTo } : {}) },
      );
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "登入失敗，請稍後重試");
        return;
      }
      if (confirming) {
        history.replaceState(null, "", "/");
        location.replace(returnTo ?? sessionStorage.getItem("p-note-return-url") ?? "/");
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
      component="section"
      aria-label="登入"
    >
      <Stack gap={24}>
        <Brand />
        <div className="login-heading">
          <Title order={embedded ? 2 : 1} size={28}>
            登入 p-note
          </Title>
          <Text mt={8} c="dimmed" size="sm" lh={1.7}>
            {confirming
              ? "確認後，就可以回到你的筆記。"
              : "不需要密碼。我們會寄送一次性登入連結到你的信箱。"}
          </Text>
        </div>
        {confirming ? (
          <Stack gap="sm">
            <Button
              loading={busy}
              leftSection={<IconCheck size={18} />}
              onClick={() => {
                void send(true);
              }}
            >
              確認登入
            </Button>
            <Text size="xs" c="dimmed">
              連結只能使用一次，請勿轉寄。
            </Text>
          </Stack>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(false);
            }}
          >
            <Stack gap="sm">
              <TextInput
                label="Email"
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                leftSection={<IconMail size={16} />}
                disabled={busy}
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
            color="blue"
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
        <Group className="login-privacy" gap={6} wrap="nowrap" c="dimmed">
          <IconLock size={14} />
          <Text size="xs">僅限已設定的擁有者登入</Text>
        </Group>
      </Stack>
    </Paper>
  );
  if (embedded) return card;
  return (
    <main className="login-page">
      <div className="login-layout">{card}</div>
      <Text className="login-footer" size="xs" c="dimmed">
        你的私人筆記與日記工作區
      </Text>
      <div style={{ margin: '12px auto 0' }}><PwaControls /></div>
    </main>
  );
}
