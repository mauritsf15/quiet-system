import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("Usage: node tools/analyze-minidump.mjs <dump.mdmp>");
const dump = await readFile(path);
if (dump.toString("ascii", 0, 4) !== "MDMP") throw new Error("Not a Windows minidump");

const u32 = (offset) => dump.readUInt32LE(offset);
const u64 = (offset) => dump.readBigUInt64LE(offset);
const streamCount = u32(8);
const directoryRva = u32(12);
const streams = new Map();
for (let index = 0; index < streamCount; index += 1) {
  const offset = directoryRva + index * 12;
  streams.set(u32(offset), { size: u32(offset + 4), rva: u32(offset + 8) });
}

const readString = (rva) => {
  const byteLength = u32(rva);
  return dump.toString("utf16le", rva + 4, rva + 4 + byteLength);
};

const modules = [];
const moduleStream = streams.get(4);
if (moduleStream) {
  const count = u32(moduleStream.rva);
  for (let index = 0; index < count; index += 1) {
    const offset = moduleStream.rva + 4 + index * 108;
    const base = u64(offset);
    const size = BigInt(u32(offset + 8));
    modules.push({ name: readString(u32(offset + 20)), base, size });
  }
}

const exceptionStream = streams.get(6);
if (!exceptionStream) throw new Error("Dump does not contain an exception stream");
const rva = exceptionStream.rva;
const code = u32(rva + 8);
const address = u64(rva + 24);
const parameterCount = u32(rva + 32);
const parameters = Array.from({ length: Math.min(parameterCount, 15) }, (_, index) => u64(rva + 40 + index * 8));
const module = modules.find((item) => address >= item.base && address < item.base + item.size);

process.stdout.write(JSON.stringify({
  exceptionCode: `0x${code.toString(16).padStart(8, "0").toUpperCase()}`,
  instructionAddress: `0x${address.toString(16).toUpperCase()}`,
  faultingModule: module?.name ?? null,
  moduleOffset: module ? `0x${(address - module.base).toString(16).toUpperCase()}` : null,
  accessType: parameters[0] === 0n ? "read" : parameters[0] === 1n ? "write" : parameters[0] === 8n ? "execute" : null,
  accessedAddress: parameters[1] === undefined ? null : `0x${parameters[1].toString(16).toUpperCase()}`,
  loadedModules: modules.map((item) => item.name),
}, null, 2));
