/**
 * Native File Picker Bridge
 *
 * Provides file selection that works in both browser and Mac Catalyst WebView.
 * Uses native NSOpenPanel on Mac Catalyst (which crashes with standard HTML file input)
 * and falls back to standard HTML file input in browsers.
 */

export interface FileSelectOptions {
  /** Accepted MIME types (e.g., ['image/jpeg', 'image/png']) */
  accept?: string[];
  /** Maximum file size in bytes (default: 10MB) */
  maxSize?: number;
}

export interface SelectedFile {
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
  /** Data URL (data:mime;base64,...) */
  data: string;
}

interface NativeBridgeResponse {
  callbackId: string;
  result?: SelectedFile;
  error?: string;
}

// Pending callbacks for native bridge responses
const pendingCallbacks = new Map<string, {
  resolve: (file: SelectedFile) => void;
  reject: (error: Error) => void;
}>();

// Register global callback handler for native bridge
if (typeof window !== 'undefined') {
  (window as any).__file_callback = (response: NativeBridgeResponse) => {
    const callback = pendingCallbacks.get(response.callbackId);
    if (!callback) {
      console.warn('[FilePicker] No callback found for:', response.callbackId);
      return;
    }
    pendingCallbacks.delete(response.callbackId);

    if (response.error) {
      callback.reject(new Error(response.error));
    } else if (response.result) {
      callback.resolve(response.result);
    } else {
      callback.reject(new Error('Invalid response from native bridge'));
    }
  };
}

/**
 * Check if running in Mac Catalyst WebView with native file picker support
 */
export function hasNativeFilePicker(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as any).isHomecastMacApp &&
    !!(window as any).webkit?.messageHandlers?.homecast;
}

/**
 * Select a file using the native picker (Mac Catalyst) or HTML input fallback
 */
export async function selectFile(options: FileSelectOptions = {}): Promise<SelectedFile> {
  if (hasNativeFilePicker()) {
    return selectFileNative(options);
  } else {
    return selectFileHTML(options);
  }
}

/**
 * Select file using native Mac Catalyst bridge
 */
async function selectFileNative(options: FileSelectOptions): Promise<SelectedFile> {
  return new Promise((resolve, reject) => {
    const callbackId = `file_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    pendingCallbacks.set(callbackId, { resolve, reject });

    // Set timeout to clean up if native doesn't respond
    const timeout = setTimeout(() => {
      if (pendingCallbacks.has(callbackId)) {
        pendingCallbacks.delete(callbackId);
        reject(new Error('Native file picker timed out'));
      }
    }, 60000); // 60 second timeout

    // Clear timeout when resolved
    const originalResolve = resolve;
    const originalReject = reject;
    pendingCallbacks.set(callbackId, {
      resolve: (file) => {
        clearTimeout(timeout);
        originalResolve(file);
      },
      reject: (error) => {
        clearTimeout(timeout);
        originalReject(error);
      }
    });

    // Call native bridge
    try {
      (window as any).webkit.messageHandlers.homecast.postMessage({
        action: 'file',
        method: 'select',
        payload: {
          accept: options.accept || ['image/*'],
          maxSize: options.maxSize || 10 * 1024 * 1024,
        },
        callbackId,
      });
    } catch (err) {
      pendingCallbacks.delete(callbackId);
      clearTimeout(timeout);
      reject(new Error('Failed to call native file picker'));
    }
  });
}

/**
 * Select file using standard HTML file input (browser fallback)
 */
async function selectFileHTML(options: FileSelectOptions): Promise<SelectedFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept?.join(',') || 'image/*';
    input.style.display = 'none';

    const cleanup = () => {
      document.body.removeChild(input);
    };

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        reject(new Error('cancelled'));
        return;
      }

      // Check file size
      const maxSize = options.maxSize || 10 * 1024 * 1024;
      if (file.size > maxSize) {
        cleanup();
        reject(new Error(`File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`));
        return;
      }

      // Read file as data URL
      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        resolve({
          name: file.name,
          size: file.size,
          type: file.type,
          data: reader.result as string,
        });
      };
      reader.onerror = () => {
        cleanup();
        reject(new Error('Failed to read file'));
      };
      reader.readAsDataURL(file);
    };

    // Handle cancel (user closes file dialog without selecting)
    input.oncancel = () => {
      cleanup();
      reject(new Error('cancelled'));
    };

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Convert a data URL to a Blob for uploading
 */
export function dataURLtoBlob(dataURL: string): Blob {
  const parts = dataURL.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Convert a data URL to a File object for uploading
 */
export function dataURLtoFile(dataURL: string, filename: string): File {
  const blob = dataURLtoBlob(dataURL);
  return new File([blob], filename, { type: blob.type });
}
