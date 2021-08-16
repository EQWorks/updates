import glob
import re

# Open output file
output_file = open('output.txt', 'a')

# Retrieve all file names and loop through
txt_files = glob.glob("./*Digest*")
for fl in txt_files:
    # Open input file
    file = open(fl, 'r')
    read_content = file.read()
    split = read_content.split("target")
    # Drop everything before first target
    split.pop(0)
    for line in split:
        clean = line.split("\">", 2)[2]
        clean2 = clean.rsplit("(", 2)[0]

        output_file.write(clean2 + '\n')

# Close output file
output_file.close()
