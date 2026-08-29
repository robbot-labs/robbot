import { Alert, Box, Button, IconButton, InputAdornment, Paper, Tab, Tabs, TextField, Typography } from '@mui/material'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthUser } from '../../robbot-api'

export function LoginPage(props: { onDone: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedLogin, setSavedLogin] = useState<{ email: string; password: string } | null>(null)
  const emailInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.robbot.auth.getSavedLogin()
      .then((saved) => {
        if (cancelled || !saved) return
        setEmail(saved.email)
        setPassword(saved.password)
        setSavedLogin(saved)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      emailInputRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setError('请输入正确的邮箱格式')
    if (!password) return setError('请输入密码')
    if (mode === 'register' && password.length < 6) return setError('密码至少 6 位')
    if (mode === 'register' && password !== confirm) return setError('两次密码不一致')

    setLoading(true)
    setError('')
    try {
      const user = mode === 'login'
        ? await window.robbot.auth.login({ email: normalizedEmail, password })
        : await window.robbot.auth.register({ email: normalizedEmail, password })
      props.onDone(user)
    } catch (cause) {
      if (mode === 'login' && savedLogin?.email === normalizedEmail && savedLogin.password === password) {
        setPassword('')
        setSavedLogin(null)
      }
      setError(cause instanceof Error ? cause.message : mode === 'login' ? '登录失败' : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  const passwordAdornment = (visible: boolean, toggle: () => void) => (
    <InputAdornment position="end">
      <IconButton
        onClick={toggle}
        edge="end"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        sx={{
          color: 'rgb(100 116 139)',
          cursor: 'pointer',
          '&:hover': { background: 'rgb(238 242 255)', color: 'rgb(79 70 229)' },
        }}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </IconButton>
    </InputAdornment>
  )

  return <Box sx={{
    minHeight: '100%',
    display: 'grid',
    gridTemplateRows: '44px minmax(0, 1fr)',
    background: '#f7f8fa',
    color: '#0f1115',
  }}>
    <Box component="header">
      {/* <Box sx={{
        display: 'grid',
        width: 24,
        height: 24,
        placeItems: 'center',
        borderRadius: '6px',
        background: '#0f1115',
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
      }}>R</Box>
      <Typography sx={{ ml: 1.25, fontSize: 13, fontWeight: 600, color: '#111827' }}>Robbot</Typography> */}
    </Box>
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 0, p: 3 }}>
      <Paper
        component="form"
        onSubmit={submit}
        elevation={0}
        sx={{
          width: 'min(408px, 100%)',
          border: '1px solid rgb(226 232 240)',
          borderRadius: '12px',
          background: '#ffffff',
          p: { xs: 3, sm: 4 },
          boxShadow: '0 18px 45px rgba(15, 17, 21, 0.06)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2.5 }}>
          <Box>
            <Typography sx={{ fontSize: 22, lineHeight: '28px', fontWeight: 700, letterSpacing: 0 }}>
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </Typography>
            <Typography sx={{ mt: 0.25, fontSize: 13, color: 'rgb(100 116 139)' }}>
              {mode === 'login' ? '登录 Robbot 继续工作' : '注册后开始使用 Robbot'}
            </Typography>
          </Box>
        </Box>
        <Tabs
          value={mode}
          onChange={(_, value: 'login' | 'register') => { setMode(value); setError('') }}
          variant="fullWidth"
          sx={{
            minHeight: 36,
            mb: 2.5,
            border: '1px solid rgb(226 232 240)',
            borderRadius: '8px',
            p: '3px',
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              minHeight: 30,
              borderRadius: '6px',
              color: 'rgb(100 116 139)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'none',
            },
            '& .Mui-selected': {
              background: 'rgb(224 231 255)',
              color: 'rgb(67 56 202) !important',
            },
          }}
        >
          <Tab value="login" label="登录" />
          <Tab value="register" label="注册" />
      </Tabs>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {error ? <Alert severity="error" sx={{ borderRadius: '8px', fontSize: 13 }}>{error}</Alert> : null}
        <TextField
          inputRef={emailInputRef}
          label="邮箱"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          fullWidth
          disabled={loading}
          size="small"
          sx={fieldSx}
        />
        <TextField
          label="密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type={showPassword ? 'text' : 'password'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          fullWidth
          disabled={loading}
          size="small"
          sx={fieldSx}
          slotProps={{ input: { endAdornment: passwordAdornment(showPassword, () => setShowPassword((value) => !value)) } }}
        />
        {mode === 'register' ? (
          <TextField
            label="确认密码"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            fullWidth
            disabled={loading}
            size="small"
            sx={fieldSx}
            slotProps={{ input: { endAdornment: passwordAdornment(showConfirm, () => setShowConfirm((value) => !value)) } }}
          />
        ) : null}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={loading}
          sx={{
            mt: 0.5,
            height: 42,
            borderRadius: '8px',
            background: 'rgb(99 102 241)',
            boxShadow: 'none',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 700,
            textTransform: 'none',
            '&:hover': { background: 'rgb(79 70 229)', boxShadow: 'none' },
            '&.Mui-disabled': { background: 'rgb(203 213 225)', color: '#ffffff' },
          }}
        >
          {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
        </Button>
      </Box>
        <Typography sx={{ mt: 2.5, textAlign: 'center', fontSize: 12, color: 'rgb(100 116 139)' }}>
          继续即表示你同意服务条款，并了解隐私政策。
        </Typography>
      </Paper>
    </Box>
  </Box>
}

const fieldSx = {
  '& .MuiInputLabel-root': {
    color: 'rgb(100 116 139)',
    fontSize: 14,
  },
  '& .MuiOutlinedInput-root': {
    borderRadius: '8px',
    background: '#ffffff',
    fontSize: 14,
    '& fieldset': { borderColor: 'rgb(226 232 240)' },
    '&:hover fieldset': { borderColor: 'rgb(148 163 184)' },
    '&.Mui-focused fieldset': { borderColor: 'rgb(99 102 241)', borderWidth: 1 },
  },
  '& .MuiInputBase-input': {
    height: 24,
    py: 1.25,
  },
} as const
