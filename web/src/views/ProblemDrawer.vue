<script setup>
import { ref, watch, computed } from 'vue';
import { TxDrawer } from '@talex-touch/tuffex/drawer';
import { TxStack } from '@talex-touch/tuffex/stack';
import { TxFlex } from '@talex-touch/tuffex/flex';
import { TxButton } from '@talex-touch/tuffex/button';
import { TxTag } from '@talex-touch/tuffex/tag';
import { TxTabs, TxTabItem } from '@talex-touch/tuffex/tabs';
import { TxTextarea } from '@talex-touch/tuffex/textarea';
import { TxSegmentedSlider } from '@talex-touch/tuffex/segmented-slider';
import { TxTimeline, TxTimelineItem } from '@talex-touch/tuffex/timeline';
import { TxEmptyState } from '@talex-touch/tuffex/empty-state';
import { TxStatusBadge } from '@talex-touch/tuffex/status-badge';
import { TxSpinner } from '@talex-touch/tuffex/spinner';
import { TxDivider } from '@talex-touch/tuffex/divider';
import { getProblem, patchProblem, openInEditor } from '../api.js';
import { DIFF_COLOR, STATUS_LABEL, STATUS_TONE } from '../constants.js';

const props = defineProps({ problemId: { type: String, default: null } });
const emit = defineEmits(['close', 'changed']);

const detail = ref(null);
const busy = ref(false);
const notes = ref('');
const tab = ref('笔记');
const saved = ref('');

const visible = computed({
  get: () => Boolean(props.problemId),
  set: (v) => {
    if (!v) emit('close');
  },
});

const statusSegments = [
  { value: 'new', label: '未开始' },
  { value: 'shaky', label: '不稳' },
  { value: 'solved', label: '已解' },
  { value: 'mastered', label: '掌握' },
];
const masterySegments = [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const scheduleOptions = [1, 3, 7, 14, 30];

watch(
  () => props.problemId,
  async (id) => {
    detail.value = null;
    saved.value = '';
    if (!id) return;
    busy.value = true;
    try {
      detail.value = await getProblem(id);
      notes.value = detail.value.notes ?? '';
    } finally {
      busy.value = false;
    }
  },
  { immediate: true },
);

async function apply(body) {
  if (!props.problemId) return;
  busy.value = true;
  try {
    detail.value = await patchProblem(props.problemId, body);
    notes.value = detail.value.notes ?? '';
    saved.value = new Date().toLocaleTimeString('zh-CN');
    emit('changed');
  } finally {
    busy.value = false;
  }
}

const meta = computed(() => detail.value?.meta ?? null);
const notesDirty = computed(() => detail.value && notes.value !== (detail.value.notes ?? ''));

function onNotesKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    apply({ notes: notes.value });
  }
}

const lastRuns = computed(() => detail.value?.runs?.slice(0, 10) ?? []);

// 未判定的用例（没 oracle、或 brute 是骨架）既不是通过也不是失败。
// 老记录没这个字段（unjudged 为 null），只能退回原来的 passed/total 判断。
function runFailed(r) {
  return r.total - r.passed - (r.unjudged ?? 0);
}
function runTitle(r) {
  const base = `判题 ${r.passed}/${r.total}`;
  return r.unjudged ? `${base} · ${r.unjudged} 未判定` : base;
}
function runColor(r) {
  if (runFailed(r) > 0) return 'error';
  if (r.unjudged) return 'warning';
  return r.passed === r.total ? 'primary' : 'error';
}
</script>

<template>
  <TxDrawer
    v-model:visible="visible"
    direction="right"
    size="560px"
    :title="meta ? `${meta.id}. ${meta.title}` : '题目'"
    mask-effect="blur"
  >
    <TxFlex v-if="busy && !detail" justify="center" style="padding: 60px 0">
      <TxSpinner />
    </TxFlex>

    <TxEmptyState
      v-else-if="detail?.error"
      variant="blank-slate"
      :title="detail.error"
      description="在终端里跑 algo new <题号> 先建立本地目录。"
    />

    <TxStack v-else-if="meta" direction="vertical" :gap="16">
      <TxFlex :gap="8" align="center" wrap>
        <TxTag :label="meta.difficulty" :color="DIFF_COLOR[meta.difficulty]" variant="soft" />
        <TxStatusBadge
          :text="STATUS_LABEL[meta.status] ?? meta.status"
          :status="STATUS_TONE[meta.status] ?? 'muted'"
        />
        <TxTag v-for="t in meta.tags" :key="t.slug" :label="t.name" variant="plain" />
      </TxFlex>

      <TxFlex :gap="8" wrap>
        <TxButton size="sm" @click="openInEditor(meta.id, 'solution.js')">
          Cursor 打开解法
        </TxButton>
        <TxButton size="sm" variant="secondary" @click="openInEditor(meta.id, 'README.md')">
          题面
        </TxButton>
        <TxButton size="sm" variant="secondary" @click="openInEditor(meta.id, 'notes.md')">
          笔记文件
        </TxButton>
        <TxButton size="sm" variant="secondary" @click="() => window.open(meta.url, '_blank')">
          力扣
        </TxButton>
      </TxFlex>

      <TxDivider />

      <div>
        <p class="field-label">状态</p>
        <TxSegmentedSlider
          :model-value="meta.status"
          :segments="statusSegments"
          show-labels
          @change="(v) => apply({ status: v })"
        />
      </div>

      <div>
        <p class="field-label">掌握度（会同时按 SM-2 重排复习）</p>
        <TxSegmentedSlider
          :model-value="meta.mastery ?? 0"
          :segments="masterySegments"
          show-labels
          @change="(v) => apply({ mastery: v, rate: v })"
        />
      </div>

      <div>
        <p class="field-label">
          手动排复习<template v-if="detail.review">
            · 当前 {{ detail.review.due_on }}</template
          >
        </p>
        <TxFlex :gap="6" wrap>
          <TxButton
            v-for="d in scheduleOptions"
            :key="d"
            size="sm"
            variant="secondary"
            @click="apply({ reviewInDays: d })"
          >
            {{ d }} 天后
          </TxButton>
        </TxFlex>
      </div>

      <TxTabs v-model="tab" placement="top" :content-padding="0">
        <TxTabItem name="笔记" icon-class="i-carbon-edit" :activation="true">
          <TxTextarea
            v-model="notes"
            :rows="14"
            placeholder="frontmatter 里的 pattern / pitfalls 会被聚合到「洞察」页"
            @keydown="onNotesKeydown"
          />
          <TxFlex :gap="10" align="center" style="margin-top: 10px">
            <TxButton size="sm" :disabled="!notesDirty" @click="apply({ notes })">
              保存（⌘S）
            </TxButton>
            <span v-if="saved" class="hint">已保存 {{ saved }}</span>
            <span v-else-if="notesDirty" class="hint">有未保存的修改</span>
          </TxFlex>
        </TxTabItem>

        <TxTabItem name="历史" icon-class="i-carbon-time">
          <TxTimeline v-if="detail.attempts.length || lastRuns.length">
            <TxTimelineItem
              v-for="a in detail.attempts"
              :key="`a${a.id}`"
              :title="`完成 · ${a.mode} · 自评 ${a.self_rating ?? '-'}/5`"
              :time="a.submitted_at.slice(0, 16).replace('T', ' ')"
              color="success"
              active
            >
              提交前本地跑了 {{ a.local_runs }} 遍{{
                a.duration_min ? `，用时 ${a.duration_min} 分钟` : ''
              }}
            </TxTimelineItem>
            <TxTimelineItem
              v-for="r in lastRuns"
              :key="`r${r.id}`"
              :title="runTitle(r)"
              :time="r.ran_at.slice(0, 16).replace('T', ' ')"
              :color="runColor(r)"
            >
              {{ r.kind === 'acm' ? 'ACM 模式' : '函数模式' }}{{ r.failure ? ` · ${r.failure}` : '' }}
            </TxTimelineItem>
          </TxTimeline>
          <TxEmptyState
            v-else
            variant="no-data"
            size="small"
            title="还没有记录"
            description="跑一次 algo test 就会出现。"
          />
        </TxTabItem>

        <TxTabItem name="解法" icon-class="i-carbon-code">
          <pre class="code">{{ detail.solution ?? '（还没有 solution.js）' }}</pre>
          <p v-if="detail.snapshots.length" class="hint" style="margin-top: 10px">
            历史快照 {{ detail.snapshots.length }} 份：{{ detail.snapshots.slice(0, 3).join('、') }}
          </p>
        </TxTabItem>
      </TxTabs>
    </TxStack>
  </TxDrawer>
</template>

<style scoped>
.field-label {
  margin: 0 0 7px;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tx-text-color-secondary);
}
.hint {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.code {
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--tx-fill-color-lighter);
  font: 12px/1.6 ui-monospace, 'SF Mono', Menlo, monospace;
  white-space: pre-wrap;
  max-height: 420px;
  overflow: auto;
}
</style>
