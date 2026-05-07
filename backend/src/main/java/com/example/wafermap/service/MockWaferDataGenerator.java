package com.example.wafermap.service;

import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

@Service
public class MockWaferDataGenerator {

    private static final float WAFER_RADIUS = 150f;  // mm
    private static final int   GRID_HALF    = 10;    // ±10 → 21×21 iteration space

    public byte[] generate(int requestedPoints,
                           float fieldSizeX, float fieldSizeY,
                           float fieldOffsetX, float fieldOffsetY) {
        List<float[]> dies = validDieCenters(fieldSizeX, fieldSizeY, fieldOffsetX, fieldOffsetY);
        int pointsPerDie = Math.max(1, requestedPoints / dies.size());
        int totalPoints  = pointsPerDie * dies.size();

        ByteBuffer buf = ByteBuffer
                .allocate(totalPoints * 6 * Float.BYTES)
                .order(ByteOrder.LITTLE_ENDIAN);

        Random rng = new Random(42);

        for (float[] center : dies) {
            // per-die systematic overlay (Gaussian, σ=10nm)
            float dieOvlX = (float) (rng.nextGaussian() * 10);
            float dieOvlY = (float) (rng.nextGaussian() * 10);

            for (int i = 0; i < pointsPerDie; i++) {
                // random position within die
                float intraX = (rng.nextFloat() - 0.5f) * fieldSizeX;
                float intraY = (rng.nextFloat() - 0.5f) * fieldSizeY;
                // overlay = die bias + random noise (σ=3nm)
                float ovlX = dieOvlX + (float) (rng.nextGaussian() * 3);
                float ovlY = dieOvlY + (float) (rng.nextGaussian() * 3);

                buf.putFloat(center[0]) // interX
                   .putFloat(center[1]) // interY
                   .putFloat(intraX)
                   .putFloat(intraY)
                   .putFloat(ovlX)
                   .putFloat(ovlY);
            }
        }

        return buf.array();
    }

    private List<float[]> validDieCenters(float fieldSizeX, float fieldSizeY,
                                          float fieldOffsetX, float fieldOffsetY) {
        // half-diagonal of a die: farthest corner from die center
        float halfDiag = (float) Math.sqrt(fieldSizeX * fieldSizeX + fieldSizeY * fieldSizeY) / 2f;
        List<float[]> centers = new ArrayList<>();
        for (int ix = -GRID_HALF; ix <= GRID_HALF; ix++) {
            for (int iy = -GRID_HALF; iy <= GRID_HALF; iy++) {
                float cx = ix * fieldSizeX + fieldOffsetX;
                float cy = iy * fieldSizeY + fieldOffsetY;
                // die is valid if its farthest corner fits inside the wafer circle
                if (Math.sqrt(cx * cx + cy * cy) <= WAFER_RADIUS - halfDiag) {
                    centers.add(new float[]{cx, cy});
                }
            }
        }
        return centers;
    }
}
