'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { acceptedSchema, cloudCreatedSchema } from '@/contracts/workbench-v2'
import { cloudLibraryKey } from '@/lib/workbench/cloud-library'
import { useWorkbench } from '@/lib/workbench/context'
import { seg, sendFile, sendJson } from '@/lib/workbench/http'

// 云端知识库（SDD 0042）：上传的、代采取回的、买来的；真源在 knowbase
export { useCloudLibrary } from '@/lib/workbench/cloud-library'

const keys = { all: cloudLibraryKey }

export function useCloudLibraryActions() {
  const { csrfToken } = useWorkbench()
  const client = useQueryClient()
  const changed = () => client.invalidateQueries({ queryKey: keys.all })
  return {
    upload: useMutation({
      mutationFn: (file: File) =>
        sendFile(
          cloudCreatedSchema,
          `/api/workbench/cloud-library?name=${encodeURIComponent(file.name)}`,
          { csrfToken, file },
        ),
      onSuccess: changed,
    }),
    remove: useMutation({
      mutationFn: (item: string) =>
        sendJson(acceptedSchema, `/api/workbench/cloud-library/${seg(item)}`, {
          csrfToken,
          method: 'DELETE',
        }),
      onSuccess: changed,
    }),
  }
}

export function downloadHref(item: string) {
  return `/api/workbench/cloud-library/${seg(item)}/content`
}
