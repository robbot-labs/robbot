import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsButton } from '../../common/SettingsButton'
import type { UpdateCheckState } from '../../../hooks/useDesktopUpdateCheck'
import { AccountSettingsPanel } from './AccountSettingsPanel'
import { readAiConfigKey } from './aiConfig'
import { LanguageSettingsPanel } from './LanguageSettingsPanel'
import { type AiField, ModelSettingsPanel } from './ModelSettingsPanel'
import { RuntimePluginsPanel } from './RuntimePluginsPanel'
import { VersionSettingsPanel } from './VersionSettingsPanel'

type SettingsModalProps = {
  open: boolean
  variant?: 'modal' | 'page'
  initialTab?: number
  email: string
  deepseek: string | null
  openai: string | null
  selectedAi: string | null
  appVersion: string
  updateCheck: UpdateCheckState
  onCheckUpdate(options?: { force?: boolean }): Promise<unknown>
  onClose(): void
  onSave(field: AiField, value: Record<string, unknown>): Promise<void>
  onSelect(field: AiField): Promise<void>
  onRuntimePluginsChanged?(): Promise<void>
  onLogout(): void
}

function tabProps(index: number) {
  return {
    id: `settings-tab-${index}`,
    'aria-controls': `settings-tabpanel-${index}`,
  }
}

function TabPanel(props: { value: number; index: number; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      hidden={props.value !== props.index}
      id={`settings-tabpanel-${props.index}`}
      aria-labelledby={`settings-tab-${props.index}`}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto"
    >
      {props.value === props.index ? props.children : null}
    </div>
  )
}

export function SettingsModal(props: SettingsModalProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState(props.initialTab ?? 0)

  if (!props.open) return null

  const close = () => {
    const selectedKey = props.selectedAi === 'deepseek' || props.selectedAi === 'openai'
      ? readAiConfigKey(props[props.selectedAi]).trim()
      : ''

    if (!props.selectedAi || !selectedKey) {
      toast.warning(t('settings.missingApiKey'), { duration: 1000 })
      return
    }

    props.onClose()
  }

  const content = (
    <div
      className={
        props.variant === 'page'
          ? 'h-full w-full overflow-hidden rounded-none bg-white'
          : 'w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl'
      }
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="m-0 text-lg font-semibold text-slate-950">{t('settings.title')}</h2>
        </div>
        <SettingsButton
          onClick={close}
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>{t('common.back')}</span>
        </SettingsButton>
      </div>

      <Box
        sx={{
          display: 'flex',
          height: props.variant === 'page' ? 'calc(100% - 65px)' : 470,
          minHeight: 0,
          minWidth: 0,
          maxHeight: props.variant === 'page' ? 'none' : '70vh',
          overflow: 'hidden',
        }}
      >
        <Tabs
          orientation="vertical"
          value={tab}
          onChange={(_, value: number) => setTab(value)}
          aria-label={t('settings.sectionsLabel')}
          sx={{
            width: 150,
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              alignItems: 'flex-start',
              cursor: 'pointer',
              color: 'rgb(100 116 139)',
              minHeight: 48,
              textTransform: 'none',
              fontSize: 13,
            },
            '& .MuiTab-root.Mui-selected': {
              color: 'rgb(67 56 202)',
            },
            '& .MuiTabs-indicator': {
              backgroundColor: 'rgb(67 56 202)',
            },
          }}
        >
          <Tab label={t('settings.tabs.model')} {...tabProps(0)} />
          <Tab label={t('settings.tabs.plugins')} {...tabProps(1)} />
          <Tab label={t('settings.tabs.account')} {...tabProps(2)} />
          <Tab label={t('settings.tabs.language')} {...tabProps(3)} />
          <Tab
            label={(
              <span className="relative inline-flex items-center">
                {t('settings.tabs.version')}
                {props.updateCheck.status === 'available' ? (
                  <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-rose-500" />
                ) : null}
              </span>
            )}
            {...tabProps(4)}
          />
        </Tabs>

        <TabPanel value={tab} index={0}>
          <ModelSettingsPanel
            deepseek={props.deepseek}
            openai={props.openai}
            selectedAi={props.selectedAi}
            onSave={props.onSave}
            onSelect={props.onSelect}
          />
        </TabPanel>

        <TabPanel value={tab} index={1}>
          <div className="p-6">
            <h3 className="m-0 text-base font-semibold text-slate-950">{t('settings.plugins.title')}</h3>
            <p className="mt-1 text-sm text-slate-500">{t('settings.plugins.description')}</p>

            <div className="mt-6">
              <RuntimePluginsPanel onRuntimePluginsChanged={props.onRuntimePluginsChanged} />
            </div>
          </div>
        </TabPanel>

        <TabPanel value={tab} index={2}>
          <AccountSettingsPanel email={props.email} onLogout={props.onLogout} />
        </TabPanel>

        <TabPanel value={tab} index={3}>
          <LanguageSettingsPanel />
        </TabPanel>

        <TabPanel value={tab} index={4}>
          <VersionSettingsPanel
            appVersion={props.appVersion}
            updateCheck={props.updateCheck}
            onCheckUpdate={props.onCheckUpdate}
          />
        </TabPanel>
      </Box>
    </div>
  )

  if (props.variant === 'page') {
    return <div className="h-full min-h-0 bg-white">{content}</div>
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4"
      onMouseDown={close}
    >
      {content}
    </div>
  )
}
