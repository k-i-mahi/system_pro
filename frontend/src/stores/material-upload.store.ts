import { create } from 'zustand';
import type { QueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import {
  idbClearAllForUser,
  idbDeletePending,
  idbGetPending,
  idbListPendingForUser,
  idbPutPending,
  type MaterialPendingRecord,
} from '@/lib/material-upload-idb';
import { useAuthStore } from '@/stores/auth.store';

export type MaterialUploadPhase = 'uploading' | 'error';

export type MaterialUploadUiItem = {
  uploadKey: string;
  courseId: string;
  topicId: string;
  fileName: string;
  phase: MaterialUploadPhase;
  errorMessage?: string;
};

let queryClient: QueryClient | null = null;
const inFlightKeys = new Set<string>();
let resumeChain: Promise<void> = Promise.resolve();

export function registerMaterialUploadQueryClient(qc: QueryClient): void {
  queryClient = qc;
}

function newUploadKey(topicId: string): string {
  const c = globalThis.crypto?.randomUUID?.();
  return c ? `${topicId}:${c}` : `${topicId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function inferMaterialType(fileName: string): 'PDF' | 'IMAGE' | 'NOTE' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.txt')) return 'NOTE';
  if (['.jpg', '.jpeg', '.png', '.webp'].some((e) => lower.endsWith(e))) return 'IMAGE';
  return 'PDF';
}

async function postMaterialMultipart(courseId: string, topicId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', file.name);
  formData.append('fileType', inferMaterialType(file.name));
  await api.post(`/courses/${courseId}/topics/${topicId}/materials`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

async function postMaterialFromRecord(row: MaterialPendingRecord): Promise<void> {
  const blob = new Blob([row.buffer], { type: row.mimeType || 'application/octet-stream' });
  const file = new File([blob], row.fileName, { type: row.mimeType || 'application/octet-stream' });
  await postMaterialMultipart(row.courseId, row.topicId, file);
}

async function invalidateCourseAfterMaterial(courseId: string, includeNotifications: boolean): Promise<void> {
  if (!queryClient) return;
  const tasks: Promise<void>[] = [
    queryClient.invalidateQueries({ queryKey: ['course', courseId] }),
    queryClient.invalidateQueries({ queryKey: ['analytics-course', courseId] }),
    queryClient.invalidateQueries({ queryKey: ['my-courses'] }),
  ];
  if (includeNotifications) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ['notifications'] }));
    tasks.push(queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] }));
  }
  await Promise.all(tasks);
}

export const useMaterialUploadStore = create<{
  items: MaterialUploadUiItem[];
  upsertUi: (item: MaterialUploadUiItem) => void;
  removeUi: (uploadKey: string) => void;
  setUiError: (uploadKey: string, message: string) => void;
  clearAllUi: () => void;
}>((set) => ({
  items: [],
  upsertUi: (item) =>
    set((s) => {
      const rest = s.items.filter((i) => i.uploadKey !== item.uploadKey);
      return { items: [...rest, item] };
    }),
  removeUi: (uploadKey) => set((s) => ({ items: s.items.filter((i) => i.uploadKey !== uploadKey) })),
  setUiError: (uploadKey, message) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.uploadKey === uploadKey ? { ...i, phase: 'error' as const, errorMessage: message } : i
      ),
    })),
  clearAllUi: () => set({ items: [] }),
}));

async function runUploadWithPersistence(row: MaterialPendingRecord, file: File): Promise<void> {
  const { upsertUi, removeUi, setUiError } = useMaterialUploadStore.getState();
  upsertUi({
    uploadKey: row.uploadKey,
    courseId: row.courseId,
    topicId: row.topicId,
    fileName: row.fileName,
    phase: 'uploading',
  });
  try {
    await postMaterialMultipart(row.courseId, row.topicId, file);
    await idbDeletePending(row.uploadKey);
    removeUi(row.uploadKey);
    await invalidateCourseAfterMaterial(row.courseId, true);
    toast.success('Material uploaded', { duration: 4000 });
  } catch (err: unknown) {
    const msg =
      (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
      (err as Error)?.message ||
      'Upload failed';
    setUiError(row.uploadKey, msg);
    toast.error(msg);
  } finally {
    inFlightKeys.delete(row.uploadKey);
  }
}

/** Queue files: persists each to IndexedDB, then uploads (survives navigation; after full reload, bytes are retried from IDB). */
export function enqueueMaterialFiles(courseId: string, topicId: string, files: File[]): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  for (const file of files) {
    const uploadKey = newUploadKey(topicId);
    void (async () => {
      if (inFlightKeys.has(uploadKey)) return;
      inFlightKeys.add(uploadKey);
      const buffer = await file.arrayBuffer();
      const row: MaterialPendingRecord = {
        uploadKey,
        userId,
        courseId,
        topicId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        buffer,
      };
      await idbPutPending(row);
      await runUploadWithPersistence(row, file);
    })();
  }
}

export async function retryMaterialUploadFromIdb(uploadKey: string): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const row = await idbGetPending(uploadKey);
  if (!row || row.userId !== userId) return;
  if (inFlightKeys.has(uploadKey)) return;
  inFlightKeys.add(uploadKey);
  const file = new File([row.buffer], row.fileName, { type: row.mimeType || 'application/octet-stream' });
  await runUploadWithPersistence(row, file);
}

/**
 * After login / hard reload: retry any pending rows still in IndexedDB (browser had aborted in-flight requests).
 * Same bytes are re-POSTed — not a resume token protocol, but durable restoration of the workflow.
 */
export function resumePersistedMaterialUploads(): Promise<void> {
  resumeChain = resumeChain.then(() => _resumePersistedMaterialUploadsInner());
  return resumeChain;
}

async function _resumePersistedMaterialUploadsInner(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const rows = await idbListPendingForUser(userId);
  const { upsertUi } = useMaterialUploadStore.getState();
  for (const row of rows) {
    if (inFlightKeys.has(row.uploadKey)) continue;
    inFlightKeys.add(row.uploadKey);
    upsertUi({
      uploadKey: row.uploadKey,
      courseId: row.courseId,
      topicId: row.topicId,
      fileName: row.fileName,
      phase: 'uploading',
    });
    void (async () => {
      try {
        await postMaterialFromRecord(row);
        await idbDeletePending(row.uploadKey);
        useMaterialUploadStore.getState().removeUi(row.uploadKey);
        await invalidateCourseAfterMaterial(row.courseId, true);
        toast.success(`Material uploaded: ${row.fileName}`, { duration: 3500 });
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
          (err as Error)?.message ||
          'Upload failed';
        useMaterialUploadStore.getState().setUiError(row.uploadKey, msg);
        toast.error(msg);
      } finally {
        inFlightKeys.delete(row.uploadKey);
      }
    })();
  }
}

/** Call on logout: drop UI rows and wipe this user's pending blobs from IndexedDB. */
export async function clearMaterialUploadSessionForUser(userId: string | null): Promise<void> {
  inFlightKeys.clear();
  useMaterialUploadStore.getState().clearAllUi();
  if (userId) await idbClearAllForUser(userId);
}
