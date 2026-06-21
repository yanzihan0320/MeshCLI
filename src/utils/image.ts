export const MAX_SIZE_MB = 5;

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function validateImage(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Invalid file type: ${file.type}`);
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error('Image too large (max 5MB)');
  }
}

export async function fileToBase64(file: File): Promise<{
  base64: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];

      resolve({
        base64,
        mimeType: file.type || 'image/png',      });
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}