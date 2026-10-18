// File System Access API 중 TS dom lib에 빠진 선언.
interface FileSystemHandlePermissionDescriptor { mode?: 'read' | 'readwrite' }
interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | FileSystemHandle }): Promise<FileSystemDirectoryHandle>;
}
