package com.example.wafermap.controller;

import com.example.wafermap.service.MockWaferDataGenerator;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class WaferDataController {

    private final MockWaferDataGenerator generator;

    public WaferDataController(MockWaferDataGenerator generator) {
        this.generator = generator;
    }

    @GetMapping(value = "/wafer-data", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> getWaferData(
            @RequestParam(defaultValue = "500000") int points,
            @RequestParam(defaultValue = "25.8") float fieldSizeX,
            @RequestParam(defaultValue = "32.5") float fieldSizeY,
            @RequestParam(defaultValue = "0.0")  float fieldOffsetX,
            @RequestParam(defaultValue = "6.101")  float fieldOffsetY) {
        byte[] data = generator.generate(points, fieldSizeX, fieldSizeY, fieldOffsetX, fieldOffsetY);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(data);
    }
}
