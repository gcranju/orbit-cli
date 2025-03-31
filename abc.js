import bs58 from "bs58";
import idl from "./idl.json";
import {
  BorshCoder,
} from "@coral-xyz/anchor";
import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const main = async () => {
  let base58Data =
    "kiYN3VfW9wwBAAAAAAAAAAAAAAAAAAAAIAAAAC6alVqFNkAxDhywwIMoIa1UTqnf53Sg2OcGtJHjPt4fBwAAAAAAAAAAAAAAAAAAABUAAAAAAAAAAAAAAAAAAACSAAAAMHgyNmY4M2M1OTk2Zjc5MjI5ZWYxNmNmN2NhNDllZWI4NjgyNTM1ZTgxYWI1OWMzMGU1NjFjYzMxN2JjYzk2YTRhOjpzYW1wbGVkYXBwOjoweGRlOTU2ZWFkMWFjMmM4ZmE5OWNiOTg1MWNiMTAwMDNkNmEwOGIxZmEzMTIwYTNmMDczZDU3NjM4OWRiYjQ0ZmMAAAAA";

  let buffer = Buffer.from(bs58.decode(base58Data));
  //remove first 8 bytes for the event cpi
  buffer = buffer.slice(8);
  
  let coder = new BorshCoder(idl);
  let args = coder.events.decode(base64.encode(buffer));
  console.log(args);
};

main();