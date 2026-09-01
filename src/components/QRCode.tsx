import React, { useMemo } from 'react';

/**
 * Lightweight, zero-dependency, pure-TypeScript QR Code Generator
 * Generates standards-compliant QR Code Matrix and renders as crisp, responsive SVG.
 */

// QR Code Constants & Tables
const PAD0 = 0xec;
const PAD1 = 0x11;

// GF(256) Math for Reed-Solomon Error Correction
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function rsComputePoly(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= poly[j];
      nextPoly[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = nextPoly;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const genPoly = rsComputePoly(ecCount);
  const result = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[ecCount - 1] = 0;
    for (let j = 0; j < ecCount; j++) {
      result[j] ^= gfMul(genPoly[j + 1], factor);
    }
  }
  return result;
}

// QR Code Specifications Table for byte mode (Version 1 to 6, ECC Level M)
// [version, totalCodewords, dataCodewords, ecCodewordsPerBlock, numBlocks]
const QR_VERSIONS = [
  { version: 1, size: 21, totalCW: 26, dataCW: 16, ecCW: 10, blocks: 1 },
  { version: 2, size: 25, totalCW: 44, dataCW: 28, ecCW: 16, blocks: 1 },
  { version: 3, size: 29, totalCW: 70, dataCW: 44, ecCW: 26, blocks: 1 },
  { version: 4, size: 33, totalCW: 100, dataCW: 64, ecCW: 18, blocks: 2 },
  { version: 5, size: 37, totalCW: 134, dataCW: 86, ecCW: 24, blocks: 2 },
  { version: 6, size: 41, totalCW: 172, dataCW: 108, ecCW: 16, blocks: 4 },
];

const ALIGNMENT_PATTERN_POS: { [ver: number]: number[] } = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

function encodeQRCodeMatrix(text: string): { matrix: boolean[][]; size: number } {
  const utf8Bytes = new TextEncoder().encode(text);
  const dataLen = utf8Bytes.length;

  // Select minimum QR version that fits the data with 4-bit mode + 8/16-bit count header
  let verConfig = QR_VERSIONS.find(v => v.dataCW >= dataLen + 3);
  if (!verConfig) {
    verConfig = QR_VERSIONS[QR_VERSIONS.length - 1];
  }

  const { version, size, totalCW, dataCW, ecCW, blocks } = verConfig;

  // Build bit buffer in Byte Mode (0100)
  const bitArray: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitArray.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4); // Byte Mode
  pushBits(dataLen, version <= 9 ? 8 : 16); // Character count

  for (let i = 0; i < dataLen; i++) {
    pushBits(utf8Bytes[i], 8);
  }

  // Terminator
  const maxBits = dataCW * 8;
  const termLen = Math.min(4, maxBits - bitArray.length);
  pushBits(0, termLen);

  // Byte align
  while (bitArray.length % 8 !== 0) {
    bitArray.push(0);
  }

  // Convert to bytes
  const dataBytes: number[] = [];
  for (let i = 0; i < bitArray.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bitArray[i + j];
    }
    dataBytes.push(b);
  }

  // Pad with alternating 0xEC and 0x11
  let padToggle = false;
  while (dataBytes.length < dataCW) {
    dataBytes.push(padToggle ? PAD1 : PAD0);
    padToggle = !padToggle;
  }

  // Calculate Reed-Solomon Error Correction per block
  const blockSize = Math.floor(dataCW / blocks);
  const allDataBlocks: Uint8Array[] = [];
  const allEcBlocks: Uint8Array[] = [];

  for (let b = 0; b < blocks; b++) {
    const start = b * blockSize;
    const end = b === blocks - 1 ? dataCW : start + blockSize;
    const blockData = new Uint8Array(dataBytes.slice(start, end));
    allDataBlocks.push(blockData);
    allEcBlocks.push(rsComputeRemainder(blockData, ecCW));
  }

  // Interleave data and EC codewords
  const finalCodewords: number[] = [];
  const maxDataBlockLen = Math.max(...allDataBlocks.map(d => d.length));
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (let b = 0; b < blocks; b++) {
      if (i < allDataBlocks[b].length) {
        finalCodewords.push(allDataBlocks[b][i]);
      }
    }
  }
  for (let i = 0; i < ecCW; i++) {
    for (let b = 0; b < blocks; b++) {
      finalCodewords.push(allEcBlocks[b][i]);
    }
  }

  // Build QR Matrix Grid
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  // Function to place 7x7 Finder Pattern with 1px separator
  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r;
        const mc = col + c;
        if (mr >= 0 && mr < size && mc >= 0 && mc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
            const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            matrix[mr][mc] = isBorder || isCenter;
          } else {
            matrix[mr][mc] = false; // Separator
          }
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // Alignment patterns
  if (ALIGNMENT_PATTERN_POS[version]) {
    const coords = ALIGNMENT_PATTERN_POS[version];
    for (const r of coords) {
      for (const c of coords) {
        if (matrix[r][c] !== null) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isCenter = dr === 0 && dc === 0;
            matrix[r + dr][c + dc] = isBorder || isCenter;
          }
        }
      }
    }
  }

  // Dark module
  matrix[4 * version + 9][8] = true;

  // Format info area reservation
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
  }

  // Fill data codewords in zigzag pattern
  let bitIdx = 0;
  const finalBits: number[] = [];
  for (const byte of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((byte >> i) & 1);
    }
  }

  let upward = true;
  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing column
    const colList = [rightCol, rightCol - 1];
    const rowList = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rowList) {
      for (const col of colList) {
        if (matrix[row][col] === null) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
          // Apply standard Mask 0 ( (row + col) % 2 == 0 )
          const mask = (row + col) % 2 === 0;
          matrix[row][col] = mask ? bit === 0 : bit === 1;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Info (Level M + Mask 0: 101010000010010)
  const FORMAT_BITS = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  for (let i = 0; i < 6; i++) matrix[8][i] = FORMAT_BITS[i] === 1;
  matrix[8][7] = FORMAT_BITS[6] === 1;
  matrix[8][8] = FORMAT_BITS[7] === 1;
  matrix[7][8] = FORMAT_BITS[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = FORMAT_BITS[i] === 1;

  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = FORMAT_BITS[i] === 1;
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = FORMAT_BITS[i] === 1;

  return { matrix: matrix as boolean[][], size };
}

interface QRCodeProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  includeMargin?: boolean;
  className?: string;
}

export function QRCodeSVG({
  value,
  size = 200,
  fgColor = '#0f172a',
  bgColor = '#ffffff',
  includeMargin = true,
  className = '',
}: QRCodeProps) {
  const { matrix, size: matrixSize } = useMemo(() => encodeQRCodeMatrix(value), [value]);

  const margin = includeMargin ? 2 : 0;
  const viewBoxSize = matrixSize + margin * 2;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      className={`shape-rendering-crispEdges ${className}`}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill={bgColor} rx={margin > 0 ? 1 : 0} />
      <g fill={fgColor}>
        {matrix.map((row, r) =>
          row.map((cell, c) =>
            cell ? (
              <rect
                key={`${r}-${c}`}
                x={c + margin}
                y={r + margin}
                width="1"
                height="1"
              />
            ) : null
          )
        )}
      </g>
    </svg>
  );
}
