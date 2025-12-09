import express from "express";
import { auth } from "@middleware/auth";
import { prisma } from "@lib/prisma";

const router = express.Router();

router.get("/:id", auth(), async (req, res) => {
  const image = await prisma.image.findUnique({
    where: { id: req.params.id },
  });
  if (!image) return res.status(404).json({ error: "Image not found" });
  res.json(image);
});

export default router;